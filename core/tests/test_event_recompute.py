from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from bluewolf_core.event_recompute import (
    SOEventNavigationPoint,
    SOEventObservationFrame,
    recompute_so_event,
    template_fingerprint,
)
from bluewolf_core.so_scoring import SOScoringObservation
from bluewolf_core.so_templates import Quarter, SORouteInstance, SORouteKind, SOTemplate, SOVehicleSlot
from bluewolf_runtime_adapter.event_observation_archive import SOEventObservationArchive


def _template(template_id: str, second_quarter: Quarter) -> SOTemplate:
    return SOTemplate(
        template_id=template_id,
        name=template_id,
        route_instances=(
            SORouteInstance(
                route_instance_id="r1",
                route_kind=SORouteKind.SINGLE,
                vehicle_slots=(
                    SOVehicleSlot("slot-a", "outer", Quarter.Q0),
                    SOVehicleSlot("slot-b", "outer", second_quarter),
                ),
            ),
        ),
    )


def _observations(phase_a: float, phase_b: float) -> tuple[SOScoringObservation, ...]:
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
            diagnostics={"source": "core-test"},
        )

    return one("v1", phase_a), one("v2", phase_b)


def _navigation(offset: float = 0.0) -> tuple[SOEventNavigationPoint, ...]:
    return (
        SOEventNavigationPoint(
            member_id="v1",
            vehicle_identifier=101,
            latitude_deg=32.0 + offset,
            longitude_deg=34.8 + offset,
            altitude_m=12.0,
            velocity_north_mps=4.0,
            velocity_east_mps=3.0,
            active=True,
            reliability=0.95,
        ),
        SOEventNavigationPoint(
            member_id="v2",
            vehicle_identifier=102,
            latitude_deg=32.0005 + offset,
            longitude_deg=34.8005 + offset,
            altitude_m=13.0,
            velocity_north_mps=0.0,
            velocity_east_mps=5.0,
            active=True,
            reliability=0.9,
        ),
    )


def _frame(at: datetime, phase_a: float = 0.0, phase_b: float = 0.5) -> SOEventObservationFrame:
    return SOEventObservationFrame(
        event_id="g-1@2026-09-15T06:00:00Z",
        server_id=7,
        group_id="g-1",
        sample_time_utc=at,
        observations=_observations(phase_a, phase_b),
        active_template_id="opposite",
        navigation=_navigation((at.second % 10) * 0.00001),
    )


def _pending_frame(at: datetime) -> SOEventObservationFrame:
    return SOEventObservationFrame(
        event_id="g-1@2026-09-15T06:00:00Z",
        server_id=7,
        group_id="g-1",
        sample_time_utc=at,
        observations=(),
        active_template_id="opposite",
        pending_reason="core_observations_incomplete",
        navigation=_navigation(),
    )


def _other_event_frame(at: datetime) -> SOEventObservationFrame:
    return SOEventObservationFrame(
        event_id="g-2@2026-09-15T07:00:00Z",
        server_id=7,
        group_id="g-2",
        sample_time_utc=at,
        observations=_observations(0.25, 0.75),
        active_template_id="opposite",
        navigation=_navigation(0.01),
    )


class EventRecomputeTests(unittest.TestCase):
    def test_template_change_recomputes_real_scores_from_same_core_observations(self) -> None:
        start = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
        frames = (_frame(start), _frame(start + timedelta(seconds=1), 0.02, 0.52))
        opposite = _template("opposite", Quarter.Q2)
        adjacent = _template("adjacent", Quarter.Q1)

        baseline = recompute_so_event(
            event_id=frames[0].event_id,
            template=opposite,
            frames=frames,
            code_version="sha-1",
            config_version="cfg-4",
            scenario_id="investigation-17",
            run_id="run-baseline",
        )
        changed = recompute_so_event(
            event_id=frames[0].event_id,
            template=adjacent,
            frames=frames,
            code_version="sha-1",
            config_version="cfg-4",
            scenario_id="investigation-17",
            run_id="run-changed",
        )

        self.assertEqual(baseline["frameCount"], 2)
        self.assertEqual(baseline["scoredFrameCount"], 2)
        self.assertEqual(baseline["missingFrameCount"], 0)
        self.assertEqual(baseline["serverId"], 7)
        self.assertEqual(baseline["groupId"], "g-1")
        self.assertEqual(baseline["scenarioId"], "investigation-17")
        self.assertEqual(baseline["templateVersion"], template_fingerprint(opposite))
        self.assertEqual(baseline["points"][0]["navigation"][0]["vehicleIdentifier"], 101)
        self.assertAlmostEqual(baseline["points"][0]["navigation"][0]["headingDeg"], 36.86989764584402)
        self.assertNotEqual(baseline["summary"]["sync"], changed["summary"]["sync"])
        self.assertNotEqual(
            baseline["points"][0]["members"][1]["positionErrorCycle"],
            changed["points"][0]["members"][1]["positionErrorCycle"],
        )
        self.assertTrue(changed["rootCauses"])
        self.assertGreater(changed["rootCauses"][0]["occurrences"], 0)

    def test_pending_frame_preserves_full_event_range_and_navigation_without_fabricating_score(self) -> None:
        start = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
        pending = _pending_frame(start)
        scored = _frame(start + timedelta(seconds=5))
        result = recompute_so_event(
            event_id=pending.event_id,
            template=_template("opposite", Quarter.Q2),
            frames=(pending, scored),
            code_version="sha-pending",
            config_version="cfg-pending",
            scenario_id="pending-range",
            run_id="pending-run",
        )

        self.assertEqual(result["startAt"], "2026-09-15T06:00:00Z")
        self.assertEqual(result["endAt"], "2026-09-15T06:00:05Z")
        self.assertEqual(result["frameCount"], 2)
        self.assertEqual(result["scoredFrameCount"], 1)
        self.assertEqual(result["missingFrameCount"], 1)
        self.assertEqual(result["points"][0]["pendingReason"], "core_observations_incomplete")
        self.assertFalse(result["points"][0]["group"]["valid"])
        self.assertIsNone(result["points"][0]["group"]["total"])
        self.assertEqual(result["points"][0]["members"], [])
        self.assertEqual(len(result["points"][0]["navigation"]), 2)
        self.assertEqual(result["points"][0]["navigation"][1]["vehicleIdentifier"], 102)
        self.assertIsNone(result["points"][1]["pendingReason"])
        self.assertEqual(len(result["points"][1]["members"]), 2)

    def test_frames_from_multiple_groups_are_rejected(self) -> None:
        start = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
        first = _frame(start)
        second = SOEventObservationFrame(
            event_id=first.event_id,
            server_id=7,
            group_id="other",
            sample_time_utc=start + timedelta(seconds=1),
            observations=_observations(0.0, 0.5),
            active_template_id="opposite",
            navigation=_navigation(),
        )
        with self.assertRaisesRegex(ValueError, "one server and one group"):
            recompute_so_event(
                event_id=first.event_id,
                template=_template("opposite", Quarter.Q2),
                frames=(first, second),
                code_version="sha",
                config_version="cfg",
            )


class EventObservationArchiveTests(unittest.TestCase):
    def test_event_evidence_is_immutable_round_trips_navigation_and_recompute_provenance_persists(self) -> None:
        start = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
        pending = _pending_frame(start)
        frame = _frame(start + timedelta(seconds=5))
        template = _template("opposite", Quarter.Q2)
        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(Path(directory) / "events.sqlite")
            self.assertTrue(archive.record_frame(pending))
            self.assertTrue(archive.record_frame(frame))
            self.assertFalse(archive.record_frame(pending))
            self.assertFalse(archive.record_frame(frame))

            conflicting = _frame(frame.sample_time_utc, 0.1, 0.6)
            with self.assertRaisesRegex(ValueError, "conflicting immutable"):
                archive.record_frame(conflicting)

            restored = archive.read_event(frame.event_id)
            self.assertEqual(restored, (pending, frame))
            self.assertEqual(restored[0].navigation, pending.navigation)
            self.assertEqual(restored[1].navigation, frame.navigation)
            self.assertEqual(restored[0].active_template_id, "opposite")
            self.assertEqual(restored[1].active_template_id, "opposite")
            listed = archive.list_events(7)
            self.assertEqual(listed[0]["eventId"], frame.event_id)
            self.assertEqual(listed[0]["frameCount"], 2)
            self.assertEqual(listed[0]["startAt"], "2026-09-15T06:00:00Z")
            self.assertEqual(listed[0]["endAt"], "2026-09-15T06:00:05Z")
            self.assertEqual(listed[0]["activeTemplateId"], "opposite")

            result = recompute_so_event(
                event_id=frame.event_id,
                template=template,
                frames=restored,
                code_version="sha-archive",
                config_version="cfg-archive",
                scenario_id="scenario-archive",
                run_id="recompute-fixed",
            )
            self.assertEqual(result["missingFrameCount"], 1)
            self.assertEqual(result["points"][0]["navigation"][0]["latitude"], 32.0)
            archive.record_recompute(result, created_at_utc=start + timedelta(minutes=1))
            saved = archive.recomputations(frame.event_id)
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]["runId"], "recompute-fixed")
            self.assertEqual(saved[0]["codeVersion"], "sha-archive")
            self.assertEqual(saved[0]["configVersion"], "cfg-archive")
            self.assertEqual(saved[0]["templateVersion"], template_fingerprint(template))
            self.assertEqual(saved[0]["missingFrameCount"], 1)
            self.assertEqual(saved[0]["points"][0]["navigation"][1]["vehicleIdentifier"], 102)

    def test_time_range_selects_intersecting_events_without_clipping_event_bounds(self) -> None:
        start = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(Path(directory) / "events.sqlite")
            archive.record_frame(_pending_frame(start))
            archive.record_frame(_frame(start + timedelta(seconds=5)))
            archive.record_frame(_other_event_frame(start + timedelta(hours=1)))

            inside_first = archive.list_events(
                7,
                from_utc=start + timedelta(seconds=2),
                to_utc=start + timedelta(seconds=3),
            )
            self.assertEqual(len(inside_first), 1)
            self.assertEqual(inside_first[0]["eventId"], "g-1@2026-09-15T06:00:00Z")
            self.assertEqual(inside_first[0]["startAt"], "2026-09-15T06:00:00Z")
            self.assertEqual(inside_first[0]["endAt"], "2026-09-15T06:00:05Z")
            self.assertEqual(inside_first[0]["frameCount"], 2)
            self.assertEqual(inside_first[0]["activeTemplateId"], "opposite")

            later_only = archive.list_events(
                7,
                from_utc=start + timedelta(minutes=30),
                to_utc=start + timedelta(hours=2),
            )
            self.assertEqual([item["eventId"] for item in later_only], ["g-2@2026-09-15T07:00:00Z"])
            self.assertEqual(later_only[0]["activeTemplateId"], "opposite")

            with self.assertRaisesRegex(ValueError, "start must not be after end"):
                archive.list_events(
                    7,
                    from_utc=start + timedelta(hours=2),
                    to_utc=start,
                )


if __name__ == "__main__":
    unittest.main()
