from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from bluewolf_core.event_recompute import SOEventObservationFrame, recompute_so_event
from bluewolf_core.so_scoring import SOScoringObservation
from bluewolf_core.so_templates import Quarter, SORouteInstance, SORouteKind, SOTemplate, SOVehicleSlot
from bluewolf_runtime_adapter.event_archive_binding import attach_event_observation_archive
from bluewolf_runtime_adapter.event_observation_archive import SOEventObservationArchive


def _template() -> SOTemplate:
    return SOTemplate(
        template_id="opposite",
        name="opposite",
        route_instances=(
            SORouteInstance(
                route_instance_id="r1",
                route_kind=SORouteKind.SINGLE,
                vehicle_slots=(
                    SOVehicleSlot("slot-a", "outer", Quarter.Q0),
                    SOVehicleSlot("slot-b", "outer", Quarter.Q2),
                ),
            ),
        ),
    )


def _observations() -> tuple[SOScoringObservation, ...]:
    def one(member_id: str, phase: float) -> SOScoringObservation:
        return SOScoringObservation(
            member_id=member_id,
            vehicle_type="outer",
            route_instance_id="r1",
            semantic_phase=phase,
            period_error_ratio=0.0,
            movement_error_ratio=0.0,
            distance_error_b_ratio=0.0,
            tangent_error_deg=0.0,
            curvature_error_ratio=0.0,
            reliability=1.0,
            speed_fraction=1.0,
            diagnostics={"source": "raw-provenance-test"},
        )
    return one("1", 0.0), one("2", 0.5)


def _frame(at: datetime, *, test_navigation: bool = False) -> SOEventObservationFrame:
    return SOEventObservationFrame(
        event_id="event-test-source",
        server_id=7,
        group_id="group-1",
        sample_time_utc=at,
        observations=_observations(),
        active_template_id="opposite",
        navigation_origin="simulation" if test_navigation else None,
        synthetic_navigation=True if test_navigation else None,
    )


class InvestigationRawProvenanceTests(unittest.TestCase):
    def test_archive_roundtrip_and_recompute_keep_test_source_and_same_pass_raw_total(self) -> None:
        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(Path(directory) / "events.sqlite")
            frame = _frame(datetime(2026, 9, 25, 4, 0, tzinfo=UTC), test_navigation=True)
            self.assertTrue(archive.record_frame(frame))
            restored = archive.read_event(frame.event_id)
            self.assertEqual(restored[0].navigation_origin, "simulation")
            self.assertIs(restored[0].synthetic_navigation, True)

            result = recompute_so_event(
                event_id=frame.event_id,
                template=_template(),
                frames=restored,
                code_version="sha-test",
                config_version="cfg-test",
                run_id="run-test",
            )
            self.assertEqual(result["source"], {
                "kind": "python-core",
                "navigationOrigin": "simulation",
                "syntheticNavigation": True,
            })
            self.assertEqual(result["points"][0]["group"]["rawTotal"], result["points"][0]["group"]["total"])

    def test_recompute_rejects_mixed_test_and_unmarked_event_frames(self) -> None:
        start = datetime(2026, 9, 25, 4, 0, tzinfo=UTC)
        with self.assertRaisesRegex(ValueError, "mixes TEST and unmarked"):
            recompute_so_event(
                event_id="event-test-source",
                template=_template(),
                frames=(_frame(start, test_navigation=True), _frame(start + timedelta(seconds=1))),
                code_version="sha-test",
                config_version="cfg-test",
                run_id="run-mixed",
            )

    def test_simulation_binding_marks_frame_before_immutable_archive_write(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "events.sqlite"
            config_path = root / "runtime.json"
            config_path.write_text(json.dumps({
                "archive": {"path": str(archive_path)},
                "navigationSource": {"mode": "simulation"},
            }), encoding="utf-8")
            runtime = SimpleNamespace(observation_sink=None)
            loop = SimpleNamespace(pipelines=(SimpleNamespace(producer=SimpleNamespace(runtime=runtime)),))
            archive = attach_event_observation_archive(loop, config_path=config_path)
            self.assertIsNotNone(archive)
            self.assertTrue(callable(runtime.observation_sink))
            frame = _frame(datetime(2026, 9, 25, 4, 0, tzinfo=UTC))
            runtime.observation_sink(frame)
            restored = archive.read_event(frame.event_id)
            self.assertEqual(restored[0].navigation_origin, "simulation")
            self.assertIs(restored[0].synthetic_navigation, True)


if __name__ == "__main__":
    unittest.main()
