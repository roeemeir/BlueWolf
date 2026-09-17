from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
import math
from time import perf_counter
import unittest

from bluewolf_core import CoreSession, VehicleSample
from bluewolf_core.geometry import closed_polyline_length, local_m_to_wgs84, point_at_phase
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)
from bluewolf_core.session import _RouteRuntimeState
from bluewolf_core.templates import SynchronizationTemplate, TemplateSlot
from bluewolf_ingest.polling import LivePollConfig, PollWindow
from bluewolf_runtime_adapter.ingest_coordinator import IngestPollResult
from bluewolf_runtime_adapter.producer import DisplayedScoreValue
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore, create_app
from bluewolf_runtime_adapter.si_producer import LiveSIRuntimeProducer
from bluewolf_runtime_adapter.si_template_config import (
    OperationalSITemplateEntry,
    OperationalSIVehicleType,
)


START = datetime(2026, 9, 17, 18, 0, tzinfo=UTC)
CENTER_LAT = 32.0853
CENTER_LON = 34.7818
RADIUS_M = 100.0
PERIOD_S = 120.0
VEHICLES = (101, 102)


def _route() -> ClosedRoute:
    points = tuple(
        CanonicalPoint(
            RADIUS_M * math.cos(2.0 * math.pi * index / 24.0),
            RADIUS_M * math.sin(2.0 * math.pi * index / 24.0),
        )
        for index in range(24)
    )
    return ClosedRoute(
        route_id="latency-si-route",
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        canonical_points=points,
        center_latitude_deg=CENTER_LAT,
        center_longitude_deg=CENTER_LON,
        length_m=closed_polyline_length(points),
        long_axis_a_m=RADIUS_M,
        short_axis_b_m=RADIUS_M,
        orientation_deg=0.0,
        estimated_period_s=PERIOD_S,
        direction=Direction.COUNTERCLOCKWISE,
        detection_quality=1.0,
    )


def _sample(route: ClosedRoute, vehicle: int, phase: float, when: datetime) -> VehicleSample:
    point = point_at_phase(route.canonical_points, phase)[0]
    latitude, longitude = local_m_to_wgs84(point, CENTER_LAT, CENTER_LON)
    tangent_phase = (phase + 0.001) % 1.0
    tangent_point = point_at_phase(route.canonical_points, tangent_phase)[0]
    scale = 1.0 / (0.001 * PERIOD_S)
    return VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=vehicle,
        vehicle_identifier=vehicle,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        velocity_east_mps=(tangent_point.east_m - point.east_m) * scale,
        velocity_north_mps=(tangent_point.north_m - point.north_m) * scale,
        reliability=1.0,
    )


def _samples(route: ClosedRoute, when: datetime, base_phase: float) -> tuple[VehicleSample, ...]:
    return (
        _sample(route, VEHICLES[0], base_phase, when),
        _sample(route, VEHICLES[1], (base_phase + 1.0 / 3.0) % 1.0, when),
    )


def _session(route: ClosedRoute) -> CoreSession:
    session = CoreSession()
    support_start = START - timedelta(minutes=5)
    for vehicle in VEHICLES:
        session._routes[(1, vehicle)] = _RouteRuntimeState(confirmed=route)
        session._route_support_start[(1, vehicle)] = support_start
    return session


def _producer(session: CoreSession, route: ClosedRoute, store: RuntimeSnapshotStore) -> LiveSIRuntimeProducer:
    template = OperationalSITemplateEntry(
        SynchronizationTemplate(
            template_id="latency-si-120",
            name="Latency SI 120",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("a", "TYPE_A", 0.0, route_role="outer"),
                TemplateSlot("b", "TYPE_A", 1.0 / 3.0, route_role="outer"),
            ),
        ),
        is_default=True,
    )
    profile = OperationalSIVehicleType(
        type_id="TYPE_A",
        min_id=100,
        max_id=199,
        work_speed_mps=route.length_m / PERIOD_S,
        si_roles=frozenset({"outer"}),
    )
    return LiveSIRuntimeProducer(
        server_id=1,
        session=session,
        templates=(template,),
        vehicle_profiles=(profile,),
        store=store,
        displayed_score_resolver=lambda _group, _time: DisplayedScoreValue(100.0, True),
    )


def _poll(session: CoreSession, samples: tuple[VehicleSample, ...], when: datetime) -> IngestPollResult:
    result = session.process_batch(samples, observed_until_utc=when)
    return IngestPollResult(
        window=PollWindow(when, when),
        samples=samples,
        core_result=result,
        server_awake=True,
        archive_result=None,
    )


async def _request_runtime(app, server_id: str = "1"):
    messages: list[dict] = []
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/v1/live-runtime",
        "raw_path": b"/v1/live-runtime",
        "query_string": f"serverId={server_id}".encode("ascii"),
        "headers": [(b"host", b"latency-test")],
        "client": ("127.0.0.1", 12345),
        "server": ("latency-test", 80),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return start["status"], json.loads(body.decode("utf-8"))


class ActiveLatencyBudgetTests(unittest.TestCase):
    def test_bw_data_010_active_update_fits_ten_second_runtime_budget(self) -> None:
        """Measure the warmed active path; upstream network latency is a separate acceptance item.

        The deterministic scheduling envelope is join tolerance (5 s) plus active
        poll cadence (3 s). The measured portion covers real CoreSession processing,
        SI scoring/publication, RuntimeSnapshotStore and the ASGI live-runtime read.
        """

        poll_config = LivePollConfig()
        self.assertEqual(poll_config.join_tolerance_seconds, 5)
        self.assertEqual(poll_config.active_poll_seconds, 3)

        route = _route()
        session = _session(route)
        store = RuntimeSnapshotStore()
        producer = _producer(session, route, store)

        # Warm grouping + temporal SI metrics before measuring a steady-state update.
        warm_at = START
        warm_poll = _poll(session, _samples(route, warm_at, 0.0), warm_at)
        warm_publication = producer.publish_poll(warm_poll)
        self.assertIsNotNone(warm_publication.snapshot)

        observed_at = START + timedelta(seconds=1)
        start = perf_counter()
        live_poll = _poll(session, _samples(route, observed_at, 1.0 / PERIOD_S), observed_at)
        publication = producer.publish_poll(live_poll)
        self.assertIsNotNone(publication.snapshot)

        # Read through the actual ASGI contract, not directly from the store.
        app = create_app(
            store,
            clock=lambda: observed_at + timedelta(seconds=poll_config.join_tolerance_seconds),
        )
        status, payload = asyncio.run(_request_runtime(app))
        measured_seconds = perf_counter() - start

        self.assertEqual(status, 200)
        self.assertEqual(payload["observedAt"], observed_at.isoformat().replace("+00:00", "Z"))
        self.assertTrue(payload["groups"])
        group = next(iter(payload["groups"].values()))
        self.assertTrue(group["scoreValid"])

        scheduling_seconds = (
            poll_config.join_tolerance_seconds + poll_config.active_poll_seconds
        )
        end_to_end_upper_bound = scheduling_seconds + measured_seconds

        # Leave a real two-second processing budget after the deterministic 8 s
        # scheduling envelope. CI noise beyond this indicates the requirement can
        # no longer be claimed from the current runtime architecture.
        self.assertLess(
            measured_seconds,
            2.0,
            f"Core->HTTP processing exceeded 2 s: {measured_seconds:.3f} s",
        )
        self.assertLess(
            end_to_end_upper_bound,
            10.0,
            f"active update budget exceeded 10 s: {end_to_end_upper_bound:.3f} s",
        )


if __name__ == "__main__":
    unittest.main()
