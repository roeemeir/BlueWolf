"""Stateful streaming shell and recoverable checkpoint for the core."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable, Mapping

from .config import CoreConfig
from .models import (
    ChangeKind,
    CoreBatchResult,
    StateChange,
    VehicleFrameResult,
    VehicleSample,
)


CHECKPOINT_SCHEMA_VERSION = 1
RESULT_SCHEMA_VERSION = 1


class CheckpointCompatibilityError(ValueError):
    """Raised when a checkpoint cannot safely restore this core session."""


@dataclass(slots=True)
class _VehicleRuntimeState:
    server_id: int
    vehicle_identifier: int
    last_sample_time_utc: datetime
    active: bool | None
    latitude_deg: float | None
    longitude_deg: float | None
    reliability: float
    no_data: bool = False
    expired: bool = False


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _config_fingerprint(config: CoreConfig) -> str:
    payload = json.dumps(config.to_dict(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class CoreSession:
    """Long-lived algorithm session.

    The route detector and group tracker plug into this stateful shell.  V1's
    first executable slice already guarantees deterministic ordering,
    lifecycle timers, overlap de-duplication and checkpoint recovery.
    """

    def __init__(self, config: CoreConfig | None = None, algorithm_version: str = "0.1.0") -> None:
        self.config = config or CoreConfig()
        self.algorithm_version = algorithm_version
        self._states: dict[tuple[int, int], _VehicleRuntimeState] = {}
        self._processed_until_utc: datetime | None = None

    @property
    def processed_until_utc(self) -> datetime | None:
        return self._processed_until_utc

    def process_batch(
        self,
        samples: Iterable[VehicleSample],
        *,
        observed_until_utc: datetime | None = None,
    ) -> CoreBatchResult:
        ordered = sorted(
            samples,
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            ),
        )
        changes: list[StateChange] = []
        frames: list[VehicleFrameResult] = []

        for sample in ordered:
            key = sample.stream_key
            current = self._states.get(key)
            if current is not None:
                if sample.sample_time_utc <= current.last_sample_time_utc:
                    # Query overlap is intentional.  A changed historical value
                    # is applied by replaying from a checkpoint in a fresh session.
                    continue
                changes.extend(self._advance_one(current, sample.sample_time_utc))
                if current.no_data:
                    changes.append(
                        StateChange(
                            sample.sample_time_utc,
                            ChangeKind.DATA_RESUMED,
                            sample.server_id,
                            sample.vehicle_identifier,
                        )
                    )
            else:
                current = _VehicleRuntimeState(
                    server_id=sample.server_id,
                    vehicle_identifier=sample.vehicle_identifier,
                    last_sample_time_utc=sample.sample_time_utc,
                    active=None,
                    latitude_deg=sample.latitude_deg,
                    longitude_deg=sample.longitude_deg,
                    reliability=sample.reliability,
                )
                self._states[key] = current

            previous_active = current.active
            if sample.active is True and previous_active is not True:
                changes.append(
                    StateChange(
                        sample.sample_time_utc,
                        ChangeKind.VEHICLE_ACTIVATED,
                        sample.server_id,
                        sample.vehicle_identifier,
                    )
                )
            elif sample.active is False and previous_active is True:
                changes.append(
                    StateChange(
                        sample.sample_time_utc,
                        ChangeKind.VEHICLE_DEACTIVATED,
                        sample.server_id,
                        sample.vehicle_identifier,
                    )
                )

            current.last_sample_time_utc = sample.sample_time_utc
            current.active = sample.active
            current.latitude_deg = sample.latitude_deg
            current.longitude_deg = sample.longitude_deg
            current.reliability = sample.reliability
            current.no_data = False
            current.expired = False
            frames.append(
                VehicleFrameResult(
                    sample_time_utc=sample.sample_time_utc,
                    server_id=sample.server_id,
                    vehicle_identifier=sample.vehicle_identifier,
                    active=sample.active,
                    latitude_deg=sample.latitude_deg,
                    longitude_deg=sample.longitude_deg,
                    reliability=sample.reliability,
                )
            )

        newest_sample = ordered[-1].sample_time_utc if ordered else None
        observed = _utc(observed_until_utc) if observed_until_utc is not None else newest_sample
        if observed is not None:
            if self._processed_until_utc is not None and observed < self._processed_until_utc:
                raise ValueError("observed_until_utc cannot move backwards")
            for state in self._states.values():
                changes.extend(self._advance_one(state, observed))
            self._processed_until_utc = observed

        changes.sort(
            key=lambda item: (
                item.change_time_utc,
                item.server_id,
                item.vehicle_identifier if item.vehicle_identifier is not None else -1,
                item.kind.value,
            )
        )
        return CoreBatchResult(
            schema_version=RESULT_SCHEMA_VERSION,
            algorithm_version=self.algorithm_version,
            frames=tuple(frames),
            changes=tuple(changes),
            processed_until_utc=self._processed_until_utc,
        )

    def _advance_one(
        self, state: _VehicleRuntimeState, observed_until: datetime
    ) -> list[StateChange]:
        changes: list[StateChange] = []
        no_data_at = state.last_sample_time_utc + timedelta(
            seconds=self.config.timing.no_data_display_seconds
        )
        expires_at = state.last_sample_time_utc + timedelta(
            seconds=self.config.grouping.membership_hold_seconds
        )
        if observed_until >= no_data_at and not state.no_data:
            state.no_data = True
            changes.append(
                StateChange(
                    no_data_at,
                    ChangeKind.DATA_LOST,
                    state.server_id,
                    state.vehicle_identifier,
                )
            )
        if observed_until >= expires_at and not state.expired:
            state.expired = True
            changes.append(
                StateChange(
                    expires_at,
                    ChangeKind.VEHICLE_EXPIRED,
                    state.server_id,
                    state.vehicle_identifier,
                )
            )
        return changes

    def export_checkpoint(self) -> bytes:
        """Return a deterministic, portable snapshot of the in-memory structs."""
        states = []
        for key in sorted(self._states):
            item = self._states[key]
            states.append(
                {
                    "server_id": item.server_id,
                    "vehicle_identifier": item.vehicle_identifier,
                    "last_sample_time_utc": _iso(item.last_sample_time_utc),
                    "active": item.active,
                    "latitude_deg": item.latitude_deg,
                    "longitude_deg": item.longitude_deg,
                    "reliability": item.reliability,
                    "no_data": item.no_data,
                    "expired": item.expired,
                }
            )
        payload = {
            "checkpoint_schema_version": CHECKPOINT_SCHEMA_VERSION,
            "algorithm_version": self.algorithm_version,
            "configuration_fingerprint": _config_fingerprint(self.config),
            "processed_until_utc": (
                _iso(self._processed_until_utc) if self._processed_until_utc is not None else None
            ),
            "states": states,
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: bytes | str,
        *,
        config: CoreConfig | None = None,
        algorithm_version: str = "0.1.0",
    ) -> CoreSession:
        config = config or CoreConfig()
        raw: Mapping[str, Any] = json.loads(
            checkpoint.decode("utf-8") if isinstance(checkpoint, bytes) else checkpoint
        )
        if raw.get("checkpoint_schema_version") != CHECKPOINT_SCHEMA_VERSION:
            raise CheckpointCompatibilityError("unsupported checkpoint schema")
        if raw.get("algorithm_version") != algorithm_version:
            raise CheckpointCompatibilityError("algorithm version does not match checkpoint")
        if raw.get("configuration_fingerprint") != _config_fingerprint(config):
            raise CheckpointCompatibilityError("configuration does not match checkpoint")

        session = cls(config=config, algorithm_version=algorithm_version)
        processed = raw.get("processed_until_utc")
        session._processed_until_utc = _parse_time(processed) if isinstance(processed, str) else None
        for value in raw.get("states", []):
            state = _VehicleRuntimeState(
                server_id=int(value["server_id"]),
                vehicle_identifier=int(value["vehicle_identifier"]),
                last_sample_time_utc=_parse_time(value["last_sample_time_utc"]),
                active=value.get("active"),
                latitude_deg=(
                    float(value["latitude_deg"])
                    if value.get("latitude_deg") is not None
                    else None
                ),
                longitude_deg=(
                    float(value["longitude_deg"])
                    if value.get("longitude_deg") is not None
                    else None
                ),
                reliability=float(value["reliability"]),
                no_data=bool(value.get("no_data", False)),
                expired=bool(value.get("expired", False)),
            )
            session._states[(state.server_id, state.vehicle_identifier)] = state
        return session

    def debug_state(self) -> dict[str, Any]:
        """Stable diagnostics for self/explainability tests; not an operator API."""
        return {
            "processed_until_utc": (
                _iso(self._processed_until_utc) if self._processed_until_utc is not None else None
            ),
            "vehicles": [asdict(self._states[key]) for key in sorted(self._states)],
        }
