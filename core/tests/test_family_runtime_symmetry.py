from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.family_runtime import FamilyRuntimeHost
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


if __name__ == "__main__":
    unittest.main()
