from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
import math
from types import SimpleNamespace
import unittest

from bluewolf_core.geometry import closed_polyline_length, local_m_to_wgs84, point_at_phase
from bluewolf_core.grouping import GroupingSnapshot, RouteGroup
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    CoreBatchResult,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleFrameResult,
    VehicleSample,
)
from bluewolf_core.templates import SynchronizationTemplate, TemplateSlot
from bluewolf_runtime_adapter.family_runtime import SIFamilyRuntimeAdapter
from bluewolf_runtime_adapter.producer import DisplayedScoreValue
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from bluewolf_runtime_adapter.si_producer import LiveSIRuntimeProducer
from bluewolf_runtime_adapter.si_template_config import (
    OperationalSITemplateEntry,
    OperationalSIVehicleType,
)


START = datetime(2026, 9, 17, 3, 0, tzinfo=UTC)
RADIUS = 100.0
PERIOD = 120.0


def _route() -> ClosedRoute:
    points = tuple(
        CanonicalPoint(
            RADIUS * math.cos(2.0 * math.pi * index / 24.0),
            RADIUS * math.sin(2.0 * math.pi * index / 24.0),
        )
        for index in range(24)
    )
    return ClosedRoute(
        route_id="si-route",
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        canonical_points=points,
        center_latitude_deg=32.0,
        center_longitude_deg=34.0,
        length_m=closed_polyline_length(points),
        long_axis_a_m=RADIUS,
        short_axis_b_m=RADIUS,
        orientation_deg=0.0,
        estimated_period_s=PERIOD,
        direction=Direction.COUNTERCLOCKWISE,
        detection_quality=1.0,
    )


def _template(offset: float) -> OperationalSITemplateEntry:
    return OperationalSITemplateEntry(
        SynchronizationTemplate(
            template_id=f"si-{offset:.6f}",
            name="SI",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("a", "TYPE_A", 0.0, route_role="outer"),
                TemplateSlot("b", "TYPE_A", offset, route_role="outer"),
            ),
        ),
        is_default=True,
    )


PROFILE = OperationalSIVehicleType(
    type_id="TYPE_A",
    min_id=100,
    max_id=199,
    work_speed_mps=closed_polyline_length(_route().canonical_points) / PERIOD,
    si_roles=frozenset({"outer"}),
)


class _Session:
    def __init__(self, route: ClosedRoute) -> None:
        self.route = route
        self.group = RouteGroup(
            group_id="g-si",
            server_id=1,
            family=RouteFamily.SI,
            member_keys=((1, 101), (1, 102)),
            route_ids=(route.route_id, route.route_id),
            base_period_s=PERIOD,
        )

    def grouping_snapshot(self) -> GroupingSnapshot:
        return GroupingSnapshot(
            groups=(self.group,),
            assignments={(1, 101): "g-si", (1, 102): "g-si"},
        )

    def confirmed_route(self, server_id: int, vehicle_identifier: int) -> ClosedRoute | None:
        if server_id == 1 and vehicle_identifier in {101, 102}:
            return self.route
        return None


def _sample(route: ClosedRoute, vehicle: int, phase: float, when: datetime) -> VehicleSample:
    point = point_at_phase(route.canonical_points, phase)[0]
    latitude, longitude = local_m_to_wgs84(
        point,
        route.center_latitude_deg,
        route.center_longitude_deg,
    )
    return VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=vehicle,
        vehicle_identifier=vehicle,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        reliability=1.0,
    )


def _poll(route: ClosedRoute, when: datetime, phase_a: float, phase_b: float):
    samples = (
        _sample(route, 101, phase_a, when),
        _sample(route, 102, phase_b, when),
    )
    frames = (
        VehicleFrameResult(
            sample_time_utc=when,
            server_id=1,
            vehicle_identifier=101,
            active=True,
            latitude_deg=samples[0].latitude_deg,
            longitude_deg=samples[0].longitude_deg,
            reliability=1.0,
            group_id="g-si",
            route_id=route.route_id,
            phase=phase_a,
            semantic_phase=None,
        ),
        VehicleFrameResult(
            sample_time_utc=when,
            server_id=1,
            vehicle_identifier=102,
            active=True,
            latitude_deg=samples[1].latitude_deg,
            longitude_deg=samples[1].longitude_deg,
            reliability=1.0,
            group_id="g-si",
            route_id=route.route_id,
            phase=phase_b,
            semantic_phase=None,
        ),
    )
    return SimpleNamespace(
        samples=samples,
        core_result=CoreBatchResult(1, "test", frames, (), when),
        window=SimpleNamespace(end_time_utc=when),
    )


def _producer(offset: float):
    route = _route()
    store = RuntimeSnapshotStore()
    producer = LiveSIRuntimeProducer(
        server_id=1,
        session=_Session(route),  # type: ignore[arg-type]
        templates=(_template(offset),),
        vehicle_profiles=(PROFILE,),
        store=store,
        displayed_score_resolver=lambda _group, _time: DisplayedScoreValue(100.0, True),
    )
    return route, store, producer


class SIProducerTests(unittest.TestCase):
    def _second_snapshot(self, offset: float):
        route, store, producer = _producer(offset)
        first = producer.publish_poll(_poll(route, START, 0.0, 1.0 / 3.0))
        self.assertIsNotNone(first.snapshot)
        first_group = first.snapshot["groups"]["si"]  # type: ignore[index]
        self.assertFalse(first_group["scoreValid"])

        step = 1.0 / PERIOD
        second = producer.publish_poll(
            _poll(route, START + timedelta(seconds=1), step, 1.0 / 3.0 + step)
        )
        self.assertIsNotNone(second.snapshot)
        stored = store.get("1")
        self.assertIsNotNone(stored)
        return second.snapshot

    def test_bw_sync_012_producer_uses_si_phase_even_when_semantic_phase_is_none(self) -> None:
        exact = self._second_snapshot(1.0 / 3.0)
        changed = self._second_snapshot(1.0 / 4.0)
        exact_group = exact["groups"]["si"]  # type: ignore[index]
        changed_group = changed["groups"]["si"]  # type: ignore[index]
        self.assertTrue(exact_group["scoreValid"])
        self.assertTrue(changed_group["scoreValid"])
        self.assertEqual(exact_group["sync"], 100.0)
        self.assertLess(changed_group["sync"], exact_group["sync"])
        self.assertEqual({member["ring"] for member in exact_group["members"]}, {"outer"})
        self.assertEqual(len(exact_group["detectedRoutes"]), 2)

    def test_bw_core_009_material_route_replacement_opens_new_si_event_without_group_split(self) -> None:
        route, _, producer = _producer(1.0 / 3.0)
        first = producer.publish_poll(_poll(route, START, 0.0, 1.0 / 3.0))
        self.assertIsNotNone(first.snapshot)
        first_group = first.snapshot["groups"]["si"]  # type: ignore[index]
        first_event_id = first_group["event"]["id"]

        replacement_route = replace(
            route,
            route_id="si-route-material-replacement",
            long_axis_a_m=route.long_axis_a_m * 1.12,
            short_axis_b_m=route.short_axis_b_m * 1.12,
            length_m=route.length_m * 1.12,
        )
        producer.session = _Session(replacement_route)  # type: ignore[assignment]
        step = 1.0 / PERIOD
        changed = producer.publish_poll(
            _poll(
                replacement_route,
                START + timedelta(seconds=1),
                step,
                1.0 / 3.0 + step,
            )
        )

        self.assertIsNotNone(changed.snapshot)
        changed_group = changed.snapshot["groups"]["si"]  # type: ignore[index]
        self.assertEqual(changed_group["id"], "g-si")
        self.assertNotEqual(changed_group["event"]["id"], first_event_id)
        self.assertEqual(
            {item["routeId"] for item in changed_group["detectedRoutes"]},
            {"si-route-material-replacement"},
        )

    def test_family_checkpoint_restore_preserves_si_runtime_without_rewarmup(self) -> None:
        route, _, producer = _producer(1.0 / 3.0)
        first = producer.publish_poll(_poll(route, START, 0.0, 1.0 / 3.0))
        self.assertIsNotNone(first.snapshot)
        first_group = first.snapshot["groups"]["si"]  # type: ignore[index]
        self.assertIn("event", first_group)
        first_event_id = first_group["event"]["id"]
        state = SIFamilyRuntimeAdapter(producer).export_state()

        restored_route, _, restored_producer = _producer(1.0 / 3.0)
        restored_adapter = SIFamilyRuntimeAdapter(restored_producer)
        restored_adapter.restore_state(state)

        step = 1.0 / PERIOD
        second = restored_producer.publish_poll(
            _poll(
                restored_route,
                START + timedelta(seconds=1),
                step,
                1.0 / 3.0 + step,
            )
        )
        self.assertIsNotNone(second.snapshot)
        group = second.snapshot["groups"]["si"]  # type: ignore[index]
        self.assertTrue(group["scoreValid"])
        self.assertEqual(group["sync"], 100.0)
        self.assertEqual(group["event"]["id"], first_event_id)

    def test_missing_vehicle_profile_fails_closed_without_publishing_group(self) -> None:
        route = _route()
        store = RuntimeSnapshotStore()
        producer = LiveSIRuntimeProducer(
            server_id=1,
            session=_Session(route),  # type: ignore[arg-type]
            templates=(_template(1.0 / 3.0),),
            vehicle_profiles=(),
            store=store,
            displayed_score_resolver=lambda _group, _time: DisplayedScoreValue(100.0, True),
        )
        result = producer.publish_poll(_poll(route, START, 0.0, 1.0 / 3.0))
        self.assertIsNone(result.snapshot)
        self.assertIn("g-si", result.skipped_groups)
        self.assertIsNone(store.get("1"))


if __name__ == "__main__":
    unittest.main()
