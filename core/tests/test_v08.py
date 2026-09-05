from __future__ import annotations

import unittest

import bluewolf_core


class V08PublicContractCompatibilityTests(unittest.TestCase):
    def test_public_version_is_v08(self) -> None:
        self.assertEqual(bluewolf_core.__version__, "0.8.0")

    def test_route_lifecycle_compatibility_alias_points_to_hardened_class(self) -> None:
        self.assertIs(bluewolf_core.RouteLifecycleV08, bluewolf_core.RouteLifecycle)

    def test_hardened_group_event_lifecycle_is_public(self) -> None:
        self.assertTrue(hasattr(bluewolf_core, "StableGroupLifecycle"))


if __name__ == "__main__":
    unittest.main()
