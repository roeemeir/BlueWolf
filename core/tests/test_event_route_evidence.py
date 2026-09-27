from __future__ import annotations

from datetime import UTC, datetime, timedelta
from tempfile import TemporaryDirectory
import unittest

from bluewolf_core.event_recompute import SOEventObservationFrame, recompute_so_event
from bluewolf_core.event_route_evidence import snapshot_closed_route
from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_runtime_adapter.event_observation_archive import SOEventObservationArchive

from test_event_recompute import _navigation, _observations, _template
from test_live_so_scoring import _route
from bluewolf_core.so_templates import Quarter


EVENT_ID = "g-route@2026-09-16T00:00:00Z"


def _frame(at: datetime, *, period_s: float = 100.0, include_routes: bool = True) -> SOEventObservationFrame:
    route = _route(period_s=period_s)
    routes = (snapshot_closed_route("r1", route),) if include_routes else ()
    return SOEventObservationFrame(
        event_id=EVENT_ID,
        server_id=7,
        group_id="g-route",
        sample_time_utc=at,
        observations=_observations(0.0, 0.5),
        active_template_id="opposite",
        navigation=_navigation(),
        routes=routes,
    )


class EventRouteEvidenceTests(unittest.TestCase):
    def test_snapshot_uses_actual_closed_route_centerline_in_wgs84(self) -> None:
        route = _route(period_s=100.0)
        snapshot = snapshot_closed_route("r1", route)
        self.assertEqual(snapshot.route_instance_id, "r1")
        self.assertEqual(snapshot.route_id, route.route_id)
        self.assertEqual(snapshot.subtype, route.subtype.value)
        self.assertEqual(len(snapshot.centerline_wgs84), len(route.canonical_points))
        expected_lat, expected_lon = local_m_to_wgs84(
            route.canonical_points[0],
            route.center_latitude_deg,
            route.center_longitude_deg,
        )
        self.assertAlmostEqual(snapshot.centerline_wgs84[0].latitude_deg, expected_lat, places=9)
        self.assertAlmostEqual(snapshot.centerline_wgs84[0].longitude_deg, expected_lon, places=9)

    def test_recompute_exposes_one_truth_backed_route_snapshot_for_event(self) -> None:
        start = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
        frames = (_frame(start), _frame(start + timedelta(seconds=1)))
        result = recompute_so_event(
            event_id=EVENT_ID,
            template=_template("opposite", Quarter.Q2),
            frames=frames,
            code_version="sha-route",
            config_version="cfg-route",
            run_id="run-route",
        )
        self.assertEqual(len(result["routes"]), 1)
        route = result["routes"][0]
        self.assertEqual(route["routeInstanceId"], "r1")
        self.assertTrue(route["routeId"])
        self.assertGreaterEqual(len(route["centerline"]), 3)
        self.assertEqual(route["subtype"], "hippodrome")

    def test_older_frames_without_route_evidence_remain_readable(self) -> None:
        start = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
        frames = (_frame(start, include_routes=False), _frame(start + timedelta(seconds=1)))
        result = recompute_so_event(
            event_id=EVENT_ID,
            template=_template("opposite", Quarter.Q2),
            frames=frames,
            code_version="sha-route",
            config_version="cfg-route",
            run_id="run-route-legacy",
        )
        self.assertEqual(len(result["routes"]), 1)

    def test_event_rejects_changing_route_geometry_inside_same_event(self) -> None:
        start = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
        frames = (_frame(start, period_s=100.0), _frame(start + timedelta(seconds=1), period_s=120.0))
        with self.assertRaisesRegex(ValueError, "changing detected-route evidence"):
            recompute_so_event(
                event_id=EVENT_ID,
                template=_template("opposite", Quarter.Q2),
                frames=frames,
                code_version="sha-route",
                config_version="cfg-route",
                run_id="run-route-conflict",
            )

    def test_sqlite_roundtrip_preserves_route_evidence_without_schema_migration(self) -> None:
        start = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
        frame = _frame(start)
        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(f"{directory}/events.sqlite3")
            self.assertTrue(archive.record_frame(frame))
            restored = archive.read_event(EVENT_ID)
        self.assertEqual(len(restored), 1)
        self.assertEqual(restored[0].routes, frame.routes)
        self.assertEqual(restored[0].routes[0].centerline_wgs84, frame.routes[0].centerline_wgs84)


if __name__ == "__main__":
    unittest.main()
