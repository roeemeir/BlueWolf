from __future__ import annotations

import inspect
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bluewolf_core.live_si_runtime import LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION
from bluewolf_core.semantic_session import CoreSession
from bluewolf_runtime_adapter.contract import LIVE_RUNTIME_SCHEMA_VERSION
import bluewolf_runtime_adapter.family_environment_factory as neutral_factory
import bluewolf_runtime_adapter.si_producer as si_producer_module
import bluewolf_runtime_adapter.si_template_config as si_template_config_module
import bluewolf_runtime_adapter.so_family_config as so_family_config_module
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.family_runtime import (
    FAMILY_RUNTIME_STATE_SCHEMA_VERSION,
    FamilyRuntimeHost,
    RuntimeFamilyAdapter,
)
from bluewolf_runtime_adapter.operational_state import (
    OPERATIONAL_STATE_SCHEMA_VERSION,
    export_operational_state,
    restore_operational_state,
)
from bluewolf_runtime_adapter.producer import RuntimePublicationResult
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

from test_mixed_environment_factory import _config


class FamilyRuntimeSymmetryTests(unittest.TestCase):
    def _build(self, config):
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            return build_operational_runtime(config, RuntimeSnapshotStore())

    def test_si_only_uses_same_host_without_so_specific_server_runtime(self) -> None:
        config = _config()
        config["templates"] = []
        config["servers"][0].pop("groups")
        loop = self._build(config)
        host = loop.pipelines[0].producer
        self.assertIsInstance(host, FamilyRuntimeHost)
        assert isinstance(host, FamilyRuntimeHost)
        self.assertEqual(host.family_names, ("si",))
        self.assertFalse(hasattr(host, "runtime"))

    def test_mixed_and_single_family_modes_share_one_host_type(self) -> None:
        mixed = self._build(_config()).pipelines[0].producer
        so_only_config = _config()
        so_only_config.pop("siTemplates")
        so_only_config.pop("siVehicleTypes")
        so_only = self._build(so_only_config).pipelines[0].producer
        si_only_config = _config()
        si_only_config["templates"] = []
        si_only_config["servers"][0].pop("groups")
        si_only = self._build(si_only_config).pipelines[0].producer

        self.assertIs(type(mixed), FamilyRuntimeHost)
        self.assertIs(type(so_only), FamilyRuntimeHost)
        self.assertIs(type(si_only), FamilyRuntimeHost)
        self.assertEqual(set(mixed.family_names), {"si", "so"})
        self.assertEqual(so_only.family_names, ("so",))
        self.assertEqual(si_only.family_names, ("si",))

    def test_session_replacement_propagates_identically_to_si_and_so(self) -> None:
        host = self._build(_config()).pipelines[0].producer
        self.assertIsInstance(host, FamilyRuntimeHost)
        assert isinstance(host, FamilyRuntimeHost)

        replacement = CoreSession()
        host.session = replacement

        self.assertIs(host.session, replacement)
        self.assertEqual(set(host.family_names), {"si", "so"})
        for family_name in host.family_names:
            self.assertIs(host.family(family_name).session, replacement)

    def test_si_and_so_use_the_same_namespaced_checkpoint_envelope(self) -> None:
        loop = self._build(_config())
        state = export_operational_state(loop, config_fingerprint="symmetry-test")
        self.assertEqual(state["schemaVersion"], OPERATIONAL_STATE_SCHEMA_VERSION)
        servers = state["servers"]
        self.assertEqual(len(servers), 1)
        producer_state = servers[0]["producer"]
        self.assertEqual(set(producer_state), {"si", "so"})
        for family in ("si", "so"):
            envelope = producer_state[family]
            self.assertEqual(envelope["schemaVersion"], FAMILY_RUNTIME_STATE_SCHEMA_VERSION)
            self.assertEqual(envelope["family"], family)
            self.assertIsInstance(envelope["producer"], dict)
            self.assertIsInstance(envelope["runtime"], dict)
        self.assertEqual(
            producer_state["si"]["runtime"]["schemaVersion"],
            LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION,
        )
        self.assertIn("scorers", producer_state["si"]["runtime"])
        self.assertNotIn("liveRuntime", servers[0])

    def test_canonical_factory_has_no_dependency_on_legacy_so_environment_factory(self) -> None:
        source = inspect.getsource(neutral_factory)
        self.assertNotIn("from .environment_factory", source)
        self.assertIn("from .runtime_config_common", source)
        self.assertIn("from .so_family_config", source)


    def test_single_family_restart_restore_parity(self) -> None:
        for family in ("si", "so"):
            with self.subTest(family=family):
                config = _config()
                if family == "si":
                    config["templates"] = []
                    config["servers"][0].pop("groups")
                else:
                    config.pop("siTemplates")
                    config.pop("siVehicleTypes")

                first = self._build(config)
                state = export_operational_state(first, config_fingerprint="symmetry-test")
                second = self._build(config)
                restore_operational_state(
                    second,
                    state,
                    config_fingerprint="symmetry-test",
                )
                restored = export_operational_state(
                    second,
                    config_fingerprint="symmetry-test",
                )

                self.assertEqual(
                    restored["servers"][0]["producer"],
                    state["servers"][0]["producer"],
                )
                host = second.pipelines[0].producer
                self.assertIsInstance(host, FamilyRuntimeHost)
                assert isinstance(host, FamilyRuntimeHost)
                self.assertEqual(host.family_names, (family,))

    def test_family_specific_modules_do_not_depend_on_sibling_family(self) -> None:
        si_source = "\n".join(
            (
                inspect.getsource(si_producer_module),
                inspect.getsource(si_template_config_module),
            )
        )
        so_source = inspect.getsource(so_family_config_module)

        for forbidden in (
            "so_family_config",
            "bluewolf_core.live_so",
            "SOFamilyRuntimeAdapter",
        ):
            self.assertNotIn(forbidden, si_source)
        for forbidden in (
            "si_producer",
            "si_template_config",
            "bluewolf_core.live_si",
            "SIFamilyRuntimeAdapter",
        ):
            self.assertNotIn(forbidden, so_source)

    def test_family_host_publishes_one_atomic_snapshot_for_mixed_families(self) -> None:
        observed_at = "2026-09-18T00:00:00Z"

        class CountingStore:
            def __init__(self) -> None:
                self.publish_count = 0
                self.last_snapshot = None

            def publish(self, snapshot) -> None:
                self.publish_count += 1
                self.last_snapshot = dict(snapshot)

        class FakeProducer:
            def __init__(self, family: str, group_id: str) -> None:
                self.family = family
                self.group_id = group_id
                self.session = None
                self.store = None

            def export_state(self) -> dict[str, object]:
                return {}

            def restore_state(self, state) -> None:
                self.assert_empty = dict(state)

            def publish_poll(self, poll) -> RuntimePublicationResult:
                del poll
                group = {
                    "id": self.group_id,
                    "family": self.family.upper(),
                    "observedAt": observed_at,
                    "members": [],
                }
                snapshot = {
                    "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
                    "serverId": "1",
                    "arena": "Operational",
                    "status": "test",
                    "observedAt": observed_at,
                    "source": {
                        "kind": "python-core",
                        "health": "healthy",
                        "detail": f"{self.family} test producer",
                    },
                    "groups": {self.family: group},
                    "groupList": [group],
                }
                return RuntimePublicationResult(snapshot, (self.group_id,), {})

        store = CountingStore()
        session = object()
        host = FamilyRuntimeHost(
            server_id=1,
            session=session,
            families=(
                RuntimeFamilyAdapter("si", FakeProducer("si", "si:test")),
                RuntimeFamilyAdapter("so", FakeProducer("so", "so:test")),
            ),
            store=store,
        )

        result = host.publish_poll(SimpleNamespace(samples=()))

        self.assertIsNotNone(result.snapshot)
        self.assertEqual(store.publish_count, 1)
        self.assertIsNotNone(store.last_snapshot)
        assert store.last_snapshot is not None
        self.assertEqual(
            {group["id"] for group in store.last_snapshot["groupList"]},
            {"si:test", "so:test"},
        )
        self.assertEqual(set(result.published_group_ids), {"si:test", "so:test"})


if __name__ == "__main__":
    unittest.main()
