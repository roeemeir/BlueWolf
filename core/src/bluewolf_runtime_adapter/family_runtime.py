"""Symmetric first-class runtime-family adapters for SI and SO.

Both families expose the same outer lifecycle: session binding, poll publication,
state export/restore and atomic composition. Family-specific algorithms remain
inside the child producer/runtime only; the server runtime never treats SO as a
base pipeline or SI as an extension.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from bluewolf_core.live_si_runtime import LiveSIRuntime
from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime

from .composite_producer import (
    CompositeRuntimeProducer,
    DiscardingRuntimeSnapshotStore,
    PositionEnrichedCompositeRuntimeProducer,
)
from .ingest_coordinator import IngestPollResult
from .producer import RuntimePublicationResult
from .service import RuntimeSnapshotStore


FAMILY_RUNTIME_STATE_SCHEMA_VERSION = "bluewolf.runtime-family.v1"


class RuntimeFamilyAdapter:
    """Common adapter contract implemented identically by every route family."""

    family: str

    def __init__(self, family: str, producer: Any) -> None:
        normalized = family.strip().lower()
        if not normalized:
            raise ValueError("runtime family name is required")
        self.family = normalized
        self.producer = producer

    @property
    def session(self):
        return self.producer.session

    @session.setter
    def session(self, value) -> None:
        self.producer.session = value

    @property
    def store(self):
        return self.producer.store

    @store.setter
    def store(self, value) -> None:
        self.producer.store = value

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        return self.producer.publish_poll(poll)

    def _export_runtime_state(self) -> Mapping[str, object]:
        return {}

    def _restore_runtime_state(self, state: Mapping[str, object]) -> None:
        if state:
            raise ValueError(f"{self.family} family has unsupported persisted runtime state")

    def export_state(self) -> dict[str, object]:
        return {
            "schemaVersion": FAMILY_RUNTIME_STATE_SCHEMA_VERSION,
            "family": self.family,
            "producer": self.producer.export_state(),
            "runtime": dict(self._export_runtime_state()),
        }

    def restore_state(self, state: Mapping[str, object]) -> None:
        # Pre-family checkpoints stored the child producer dictionary directly.
        # Accept it only as a migration shape; every new save uses the common
        # family envelope above.
        if state.get("schemaVersion") is None:
            self.producer.restore_state(state)
            return
        if state.get("schemaVersion") != FAMILY_RUNTIME_STATE_SCHEMA_VERSION:
            raise ValueError(f"unsupported {self.family} family state schema")
        if state.get("family") != self.family:
            raise ValueError("runtime family state belongs to a different family")
        raw_producer = state.get("producer")
        raw_runtime = state.get("runtime")
        if not isinstance(raw_producer, Mapping):
            raise ValueError("runtime family producer state must be an object")
        if not isinstance(raw_runtime, Mapping):
            raise ValueError("runtime family algorithm state must be an object")
        self.producer.restore_state(raw_producer)
        self._restore_runtime_state(raw_runtime)


class SOFamilyRuntimeAdapter(RuntimeFamilyAdapter):
    def __init__(self, producer: Any) -> None:
        super().__init__("so", producer)

    def _export_runtime_state(self) -> Mapping[str, object]:
        return self.producer.runtime.export_state()

    def _restore_runtime_state(self, state: Mapping[str, object]) -> None:
        current = self.producer.runtime
        restored, invalidated = LiveSOEventRuntime.from_state(
            current.bank,
            state,
            scoring_config=current.scorer.scoring_config,
            event_config=current.event_engine.config,
            observation_sink=current.observation_sink,
            lifecycle_sink=current.lifecycle_sink,
        )
        if invalidated:
            ids = ", ".join(item.template_id for item in invalidated)
            raise ValueError(
                f"persisted manual template selections are invalid under current bank: {ids}"
            )
        self.producer.runtime = restored

    def restore_legacy_runtime(self, state: Mapping[str, object]) -> None:
        self._restore_runtime_state(state)


class SIFamilyRuntimeAdapter(RuntimeFamilyAdapter):
    """SI is a first-class stateful runtime sibling of SO."""

    def __init__(self, producer: Any) -> None:
        super().__init__("si", producer)

    def _export_runtime_state(self) -> Mapping[str, object]:
        return self.producer.runtime.export_state()

    def _restore_runtime_state(self, state: Mapping[str, object]) -> None:
        current = self.producer.runtime
        templates = tuple(entry.template for entry in self.producer.templates)
        self.producer.runtime = LiveSIRuntime.from_state(
            templates,
            state,
            scoring_config=current.scoring_config,
            event_config=current.event_engine.config,
            observation_sink=current.observation_sink,
            lifecycle_sink=current.lifecycle_sink,
        )


class FamilyRuntimeHost:
    """One server host containing equal SI/SO family siblings and one commit."""

    def __init__(
        self,
        *,
        server_id: int,
        session: Any,
        families: tuple[RuntimeFamilyAdapter, ...],
        store: RuntimeSnapshotStore,
    ) -> None:
        if not families:
            raise ValueError("at least one runtime family is required")
        names = [family.family for family in families]
        if len(names) != len(set(names)):
            raise ValueError("runtime family names must be unique")
        self.server_id = server_id
        self.families = families
        self.store = store
        sink = DiscardingRuntimeSnapshotStore()
        for family in self.families:
            family.store = sink
        self.composite = CompositeRuntimeProducer(
            server_id=server_id,
            producers=tuple((family.family, family) for family in self.families),
            store=store,
        )
        self.positioned = PositionEnrichedCompositeRuntimeProducer(self.composite, store)
        self.session = session

    @property
    def family_names(self) -> tuple[str, ...]:
        return tuple(family.family for family in self.families)

    def family(self, name: str) -> RuntimeFamilyAdapter:
        normalized = name.strip().lower()
        for family in self.families:
            if family.family == normalized:
                return family
        raise KeyError(normalized)

    @property
    def session(self):
        return self._session

    @session.setter
    def session(self, value) -> None:
        self._session = value
        for family in self.families:
            family.session = value

    def export_state(self) -> dict[str, object]:
        return self.composite.export_state()

    def restore_state(self, state: Mapping[str, object]) -> None:
        self.composite.restore_state(state)

    def restore_legacy_so_runtime(self, state: Mapping[str, object]) -> None:
        family = self.family("so")
        if not isinstance(family, SOFamilyRuntimeAdapter):
            raise ValueError("SO family adapter does not support legacy runtime restore")
        family.restore_legacy_runtime(state)

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        return self.positioned.publish_poll(poll)


__all__ = [
    "FAMILY_RUNTIME_STATE_SCHEMA_VERSION",
    "FamilyRuntimeHost",
    "RuntimeFamilyAdapter",
    "SIFamilyRuntimeAdapter",
    "SOFamilyRuntimeAdapter",
]
