"""Test nav source -> production temporal join -> real route confirmation.

A synthetic navigation input is allowed, but no detected route, group, score,
or event is injected into Core. This test does NOT claim full product E2E.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import unittest

from bluewolf_core import ChangeKind, CoreSession
from bluewolf_core.models import RouteFamily
from bluewolf_ingest.navigation_simulation import (
    SimulatedNavigationMetricAdapter,
    SyntheticNavigationVehicle,
)
from bluewolf_ingest.window_reader import InfluxDB2WindowReader

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


class NavigationRouteConfirmationTests(unittest.TestCase):
    def test_circle_is_confirmed_from_joined_navigation_without_injected_route(self):
        period_s = 60.0
        duration_s = 120
        adapter = SimulatedNavigationMetricAdapter(
            vehicles=(SyntheticNavigationVehicle(
                server_id=1,
                vehicle_number=101,
                center_latitude_deg=32.08,
                center_longitude_deg=34.79,
                radius_m=100.0,
                period_s=period_s,
                phase_fraction=0.0,
            ),),
            started_at_utc=START,
            sample_seconds=1,
            clock=lambda: START + timedelta(seconds=duration_s + 1),
        )
        reader = InfluxDB2WindowReader(adapter)
        samples = reader.read_samples(
            server_id=1,
            server_tag_value=None,
            start_time_utc=START,
            end_time_utc=START + timedelta(seconds=duration_s),
        )
        self.assertEqual(len(samples), duration_s + 1)
        session = CoreSession()
        result = session.process_batch(
            samples, observed_until_utc=START + timedelta(seconds=duration_s)
        )
        confirmed_changes = [
            change for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
        ]
        self.assertTrue(confirmed_changes, "real Core did not confirm a route from navigation-only SIM")
        route = session.confirmed_route(1, 101)
        self.assertIsNotNone(route)
        self.assertIs(route.family, RouteFamily.SI)
        self.assertGreater(route.estimated_period_s, period_s * 0.8)
        self.assertLess(route.estimated_period_s, period_s * 1.2)
        self.assertEqual({sample.server_id for sample in samples}, {1})
        self.assertFalse(hasattr(adapter, "confirmed_route"))


if __name__ == "__main__":
    unittest.main()
