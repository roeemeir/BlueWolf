"""Three-server mixed SI+SO raw TEST navigation through immutable event archive.

No route, structural group, score or event identity is supplied as observed
input. Product configuration contains only templates and explicit SO deployment
bindings. The actual Core must derive both families, publish their same-pass raw
scores, archive TEST provenance before immutable hashing, and recompute from
that archived evidence without changing source identity.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
import math
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bluewolf_core.event_recompute import recompute_si_event, recompute_so_event
from bluewolf_runtime_adapter import qa_service
from bluewolf_runtime_adapter.event_archive_binding import attach_event_archives
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.qa_service import QaEnabledASGI
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_navigation_simulation_pipeline import _config

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


async def _request(app, path: str, *, method: str = "GET", query: str = "", payload: dict | None = None):
    messages = []
    body = json.dumps(payload or {}).encode("utf-8")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": query.encode("utf-8"),
        "headers": [
            (b"host", b"test"),
            (b"content-type", b"application/json"),
            (b"authorization", b"Bearer mixed-test-token"),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }
    delivered = False

    async def receive():
        nonlocal delivered
        if delivered:
            return {"type": "http.request", "body": b"", "more_body": False}
        delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return start["status"], json.loads(response_body.decode("utf-8"))


async def _base(scope, receive, send):
    del scope, receive
    await send({"type": "http.response.start", "status": 404, "headers": []})
    await send({"type": "http.response.body", "body": b"{}"})


class MixedNavigationArchiveRecomputeTests(unittest.TestCase):
    def test_three_servers_derive_both_families_then_archive_and_recompute_test_truth(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "mixed-navigation.sqlite"
            config_path = root / "runtime.json"
            config = _config(str(archive_path))
            config["displayedScore"] = {"mode": "core"}
            config["polling"]["idleProbeSeconds"] = 5

            circle_period_s = 60.0
            circle_radius_m = 100.0
            circle_speed = 2.0 * math.pi * circle_radius_m / circle_period_s
            config["siVehicleTypes"][0]["maxId"] = 399
            config["siVehicleTypes"][0]["workSpeedMps"] = circle_speed
            for vehicle in config["navigationSource"]["vehicles"]:
                vehicle["periodSeconds"] = circle_period_s
                vehicle["radiusMeters"] = circle_radius_m

            hippo_radius_m = 60.0
            hippo_straight_m = 220.0
            hippo_period_s = 90.0
            hippo_speed = (2.0 * hippo_straight_m + 2.0 * math.pi * hippo_radius_m) / hippo_period_s
            config["templates"] = [{
                "id": "mixed-so-two-routes",
                "name": "Two independently observed neighboring hippodromes",
                "default": True,
                "routes": [
                    {"id": "r1", "kind": "single", "slots": [
                        {"id": "first", "vehicleType": "A", "quarter": "Q0"},
                    ]},
                    {"id": "r2", "kind": "single", "slots": [
                        {"id": "second", "vehicleType": "A", "quarter": "Q2"},
                    ]},
                ],
            }]

            for server in config["servers"]:
                server_id = int(server["id"])
                center = 32.08 + server_id * 0.01
                first_id, second_id = server_id * 100 + 11, server_id * 100 + 12
                config["navigationSource"]["vehicles"].extend([
                    {
                        "serverId": server_id,
                        "vehicleNumber": first_id,
                        "centerLatitude": center + 0.0040,
                        "centerLongitude": 34.79,
                        "radiusMeters": hippo_radius_m,
                        "straightLengthMeters": hippo_straight_m,
                        "periodSeconds": hippo_period_s,
                        "phaseFraction": 0.0,
                        "shape": "hippodrome",
                    },
                    {
                        "serverId": server_id,
                        "vehicleNumber": second_id,
                        "centerLatitude": center + 0.0055,
                        "centerLongitude": 34.79,
                        "radiusMeters": hippo_radius_m,
                        "straightLengthMeters": hippo_straight_m,
                        "periodSeconds": hippo_period_s,
                        "phaseFraction": 0.5,
                        "shape": "hippodrome",
                    },
                ])
                server["groups"] = [{
                    "name": f"SO server {server_id}",
                    "arena": "test-only",
                    "color": "#3366cc",
                    "routeInstances": [
                        {"id": "r1", "kind": "single"},
                        {"id": "r2", "kind": "single"},
                    ],
                    "members": [
                        {"vehicleId": first_id, "vehicleType": "A", "routeInstanceId": "r1", "workSpeedMps": hippo_speed},
                        {"vehicleId": second_id, "vehicleType": "A", "routeInstanceId": "r2", "workSpeedMps": hippo_speed},
                    ],
                }]

            config_path.write_text(json.dumps(config), encoding="utf-8")
            environment = {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": directory,
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
                "BLUEWOLF_INFLUX_TOKEN": "",
            }
            store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment):
                loop = build_operational_runtime(config, store)
                attached = attach_event_archives(loop, config_path=config_path)
            self.assertIsNotNone(attached)
            observation_archive, _lifecycle_archive = attached
            source = loop.pipelines[0].coordinator.reader.adapter
            self.assertTrue(all(pipeline.coordinator.reader.adapter is source for pipeline in loop.pipelines))

            completed = False
            for elapsed in range(10, 361, 5):
                now = START + timedelta(seconds=elapsed)
                source.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"mixed navigation pipeline failed at {elapsed}s: {tick.errors}")
                completed = True
                for server_id in (1, 2, 3):
                    latest = store.get(str(server_id))
                    if latest is None:
                        completed = False
                        break
                    families = {
                        group["family"]
                        for group in latest["groupList"]
                        if group["scoreValid"] and group.get("event", {}).get("id")
                    }
                    if families != {"SI", "SO"}:
                        completed = False
                        break
                if completed:
                    break
            self.assertTrue(completed, "all three servers must publish scored SI and SO events from raw navigation")

            for pipeline in loop.pipelines:
                server_id = pipeline.server_id
                latest = store.get(str(server_id))
                self.assertIsNotNone(latest)
                self.assertEqual(latest["source"]["navigationOrigin"], "simulation")
                self.assertIs(latest["source"]["syntheticNavigation"], True)
                scored = {group["family"]: group for group in latest["groupList"] if group["scoreValid"]}
                self.assertEqual(set(scored), {"SI", "SO"})
                for group in scored.values():
                    self.assertIsInstance(group.get("rawTotal"), (int, float))
                    self.assertGreaterEqual(group["rawTotal"], 0)
                    self.assertLessEqual(group["rawTotal"], 100)

                si_group = scored["SI"]
                so_group = scored["SO"]
                si_frames = observation_archive.read_event(si_group["event"]["id"])
                so_frames = observation_archive.read_event(so_group["event"]["id"])
                self.assertTrue(si_frames)
                self.assertTrue(so_frames)
                for frame in (*si_frames, *so_frames):
                    self.assertEqual(frame.server_id, server_id)
                    self.assertEqual(frame.navigation_origin, "simulation")
                    self.assertIs(frame.synthetic_navigation, True)

                host = pipeline.producer
                si_template = host.family("si").producer.runtime.templates[0]
                so_template = host.family("so").producer.runtime.bank.template_by_id("mixed-so-two-routes")
                self.assertIsNotNone(so_template)

                si_recompute = recompute_si_event(
                    event_id=si_group["event"]["id"],
                    template=si_template,
                    frames=si_frames,
                    code_version="mixed-e2e-test",
                    config_version="mixed-e2e-config",
                    run_id=f"si-{server_id}",
                )
                so_recompute = recompute_so_event(
                    event_id=so_group["event"]["id"],
                    template=so_template,
                    frames=so_frames,
                    code_version="mixed-e2e-test",
                    config_version="mixed-e2e-config",
                    run_id=f"so-{server_id}",
                )
                for result in (si_recompute, so_recompute):
                    self.assertEqual(result["serverId"], server_id)
                    self.assertEqual(result["source"], {
                        "kind": "python-core",
                        "navigationOrigin": "simulation",
                        "syntheticNavigation": True,
                    })
                    scored_points = [point for point in result["points"] if point["group"]["valid"]]
                    self.assertTrue(scored_points)
                    self.assertTrue(all(
                        point["group"]["rawTotal"] == point["group"]["total"]
                        for point in scored_points
                    ))

            # Exercise the production investigation ASGI boundary against the
            # same three-server runtime and immutable archive, not a fixture.
            app = QaEnabledASGI(_base, token="mixed-test-token")
            host = SimpleNamespace(loop=SimpleNamespace(
                pipelines=loop.pipelines,
                config_fingerprint="mixed-http-config",
            ))
            with (
                patch.object(qa_service, "event_archive", observation_archive),
                patch.object(qa_service, "event_lifecycle_archive", _lifecycle_archive),
                patch.object(qa_service.service, "operational_host", host),
                patch.dict(os.environ, {"BLUEWOLF_CODE_SHA": "mixed-http-sha"}, clear=False),
            ):
                for server_id in (1, 2, 3):
                    status, listing = asyncio.run(_request(
                        app,
                        "/v1/investigation/events",
                        query=f"serverId={server_id}",
                    ))
                    self.assertEqual(status, 200)
                    self.assertEqual(listing["serverId"], server_id)
                    self.assertEqual({row["family"] for row in listing["templates"]}, {"SI", "SO"})
                    event_ids = {row["eventId"] for row in listing["events"]}
                    latest = store.get(str(server_id))
                    self.assertIsNotNone(latest)
                    scored = {group["family"]: group for group in latest["groupList"] if group["scoreValid"]}
                    self.assertIn(scored["SI"]["event"]["id"], event_ids)
                    self.assertIn(scored["SO"]["event"]["id"], event_ids)

                    for family, template_id in (
                        ("SI", "sim-input-si-template"),
                        ("SO", "mixed-so-two-routes"),
                    ):
                        event_id = scored[family]["event"]["id"]
                        status, result = asyncio.run(_request(
                            app,
                            "/v1/investigation/recompute",
                            method="POST",
                            payload={
                                "eventId": event_id,
                                "templateId": template_id,
                                "scenarioId": f"http-{family.lower()}-{server_id}",
                            },
                        ))
                        self.assertEqual(status, 200, result)
                        self.assertEqual(result["serverId"], server_id)
                        self.assertEqual(result["family"], family)
                        self.assertEqual(result["codeVersion"], "mixed-http-sha")
                        self.assertEqual(result["configVersion"], "mixed-http-config")
                        self.assertEqual(result["source"], {
                            "kind": "python-core",
                            "navigationOrigin": "simulation",
                            "syntheticNavigation": True,
                        })
                        scored_points = [point for point in result["points"] if point["group"]["valid"]]
                        self.assertTrue(scored_points)
                        self.assertTrue(all(
                            point["group"]["rawTotal"] == point["group"]["total"]
                            for point in scored_points
                        ))


if __name__ == "__main__":
    unittest.main()
