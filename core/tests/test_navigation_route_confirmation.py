"""Test navigation -> production temporal join -> real route and group decisions.

Synthetic navigation is allowed, but no route, group, score or event is
injected into Core. This test does NOT claim full product E2E.
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


def _vehicle(number: int, phase: float) -> SyntheticNavigationVehicle:
    return SyntheticNavigationVehicle(
        server_id=1,
        vehicle_number=number,
        center_latitude_deg=32.08,
        center_longitude_deg=34.79,
        radius_m=100.0,
        period_s=60.0,
        phase_fraction=phase,
    )


def _samples(*vehicles: SyntheticNavigationVehicle):
    duration_s = 120
    adapter = SimulatedNavigationMetricAdapter(
        vehicles=tuple(vehicles),
        started_at_utc=START,
        sample_seconds=1,
        clock=lambda: START + timedelta(seconds=duration_s + 1),
    )
    samples = InfluxDB2WindowReader(adapter).read_samples(
        server_id=1,
        server_tag_value=None,
        start_time_utc=START,
        end_time_utc=START + timedelta(seconds=duration_s),
    )
    return adapter, samples


class NavigationRouteConfirmationTests(unittest.TestCase):
    def test_circle_is_confirmed_from_joined_navigation_without_injected_route(self):
        adapter, samples = _samples(_vehicle(101, 0.0))
        self.assertEqual(len(samples), 121)
        session = CoreSession()
        result = session.process_batch(
            samples, observed_until_utc=START + timedelta(seconds=120)
        )
        confirmed_changes = [
            change for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
        ]
        self.assertTrue(confirmed_changes, "real Core did not confirm a route from navigation-only SIM")
        route = session.confirmed_route(1, 101)
        self.assertIsNotNone(route)
        self.assertIs(route.family, RouteFamily.SI)
        self.assertGreater(route.estimated_period_s, 48.0)
        self.assertLess(route.estimated_period_s, 72.0)
        self.assertEqual({sample.server_id for sample in samples}, {1})
        self.assertFalse(hasattr(adapter, "confirmed_route"))

    def test_two_navigation_streams_form_an_actual_core_geometry_group(self):
        adapter, samples = _samples(_vehicle(101, 0.0), _vehicle(102, 0.5))
        self.assertEqual(len(samples), 242)
        session = CoreSession()
        result = session.process_batch(
            samples, observed_until_utc=START + timedelta(seconds=120)
        )
        self.assertEqual({sample.vehicle_identifier for sample in samples}, {101, 102})
        confirmed = [
            change for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
        ]
        self.assertGreaterEqual(len(confirmed), 2, "Core did not confirm both vehicle routes")
        for number in (101, 102):
            route = session.confirmed_route(1, number)
            self.assertIsNotNone(route)
            self.assertIs(route.family, RouteFamily.SI)
        grouped = [
            group for group in session.grouping_snapshot().groups
            if group.server_id == 1
            and group.family is RouteFamily.SI
            and {(1, 101), (1, 102)}.issubset(set(group.member_keys))
        ]
        self.assertTrue(grouped, "Core did not create a real group from the two confirmed routes")
        self.assertFalse(hasattr(adapter, "grouping_snapshot"))


if __name__ == "__main__":
    unittest.main()
