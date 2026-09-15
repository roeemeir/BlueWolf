from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bluewolf_core.event_recompute import SOEventObservationFrame
from bluewolf_core.so_scoring import SOScoringObservation
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_templates import Quarter, SORouteInstance, SORouteKind, SOTemplate, SOVehicleSlot
from bluewolf_runtime_adapter.event_observation_archive import SOEventObservationArchive
import bluewolf_runtime_adapter.qa_service as qa_service
from bluewolf_runtime_adapter.qa_service import QaEnabledASGI


NOW = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
EVENT_ID = "g1@2026-09-15T06:00:00Z"


def _template() -> SOTemplate:
    return SOTemplate(
        template_id="template-opposite",
        name="Opposite",
        route_instances=(
            SORouteInstance(
                route_instance_id="r1",
                route_kind=SORouteKind.SINGLE,
                vehicle_slots=(
                    SOVehicleSlot("a", "A", Quarter.Q0),
                    SOVehicleSlot("b", "A", Quarter.Q2),
                ),
            ),
        ),
    )


def _observation(member: str, phase: float) -> SOScoringObservation:
    return SOScoringObservation(
        member_id=member,
        vehicle_type="A",
        route_instance_id="r1",
        semantic_phase=phase,
        period_error_ratio=0.0,
        movement_error_ratio=0.0,
        distance_error_b_ratio=0.0,
        tangent_error_deg=0.0,
        curvature_error_ratio=0.0,
        reliability=1.0,
        speed_fraction=1.0,
        diagnostics={"source": "core"},
    )


def _frame() -> SOEventObservationFrame:
    return SOEventObservationFrame(
        event_id=EVENT_ID,
        server_id=1,
        group_id="g1",
        sample_time_utc=NOW,
        observations=(_observation("v1", 0.0), _observation("v2", 0.5)),
    )


async def _request(
    app,
    path: str,
    *,
    method: str = "GET",
    query: str = "",
    payload: dict | None = None,
    token: str | None = None,
):
    messages = []
    headers = [(b"host", b"test"), (b"content-type", b"application/json")]
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode("utf-8")))
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
        "headers": headers,
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


class InvestigationServiceTests(unittest.TestCase):
    def test_event_list_and_recompute_use_archive_and_active_core_template_bank(self) -> None:
        template = _template()
        bank = SOTemplateBank((SOTemplateBankEntry(template, is_default=True),))
        scorer = SimpleNamespace(scoring_config=None, minimum_valid_vehicles=2)
        runtime = SimpleNamespace(bank=bank, scorer=scorer)
        pipeline = SimpleNamespace(server_id=1, producer=SimpleNamespace(runtime=runtime))
        host = SimpleNamespace(loop=SimpleNamespace(pipelines=(pipeline,), config_fingerprint="cfg-real"))

        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(Path(directory) / "events.sqlite")
            archive.record_frame(_frame())
            app = QaEnabledASGI(_base, token="secret")
            with (
                patch.object(qa_service, "event_archive", archive),
                patch.object(qa_service.service, "operational_host", host),
                patch.dict(os.environ, {"BLUEWOLF_CODE_SHA": "sha-real"}, clear=False),
            ):
                status, listing = asyncio.run(
                    _request(
                        app,
                        "/v1/investigation/events",
                        method="GET",
                        query="serverId=1",
                        token="secret",
                    )
                )
                self.assertEqual(status, 200)
                self.assertEqual(listing["schemaVersion"], "bluewolf.investigation-events.v1")
                self.assertEqual(listing["events"][0]["eventId"], EVENT_ID)
                self.assertEqual(listing["events"][0]["frameCount"], 1)

                status, result = asyncio.run(
                    _request(
                        app,
                        "/v1/investigation/recompute",
                        method="POST",
                        payload={
                            "eventId": EVENT_ID,
                            "templateId": template.template_id,
                            "scenarioId": "investigation-test",
                        },
                        token="secret",
                    )
                )
                self.assertEqual(status, 200)
                self.assertEqual(result["schemaVersion"], "bluewolf.event-recompute.v1")
                self.assertEqual(result["eventId"], EVENT_ID)
                self.assertEqual(result["scenarioId"], "investigation-test")
                self.assertEqual(result["codeVersion"], "sha-real")
                self.assertEqual(result["configVersion"], "cfg-real")
                self.assertEqual(result["templateId"], template.template_id)
                self.assertEqual(result["frameCount"], 1)
                saved = archive.recomputations(EVENT_ID)
                self.assertEqual(len(saved), 1)
                self.assertEqual(saved[0]["runId"], result["runId"])

    def test_investigation_fails_closed_when_archive_or_event_is_missing(self) -> None:
        app = QaEnabledASGI(_base, token="secret")
        with patch.object(qa_service, "event_archive", None):
            status, payload = asyncio.run(
                _request(
                    app,
                    "/v1/investigation/events",
                    method="GET",
                    query="serverId=1",
                    token="secret",
                )
            )
        self.assertEqual(status, 503)
        self.assertEqual(payload["status"], "unavailable")

    def test_investigation_uses_same_auth_boundary_as_live_runtime(self) -> None:
        app = QaEnabledASGI(_base, token="secret")
        status, payload = asyncio.run(
            _request(app, "/v1/investigation/events", method="GET", query="serverId=1")
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")


if __name__ == "__main__":
    unittest.main()
