from __future__ import annotations

import asyncio
import json
import os
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.qa_runner import QA_RUN_SCHEMA_VERSION, run_deterministic_qa
from bluewolf_runtime_adapter.qa_service import QaEnabledASGI


async def _request(
    app,
    path: str,
    *,
    method: str = "POST",
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
        "query_string": b"",
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


def _qa_result(*, code_sha: str = "sha-fixed", config_version: str = "cfg-runtime"):
    return {
        "schemaVersion": QA_RUN_SCHEMA_VERSION,
        "runId": "qa-fixed",
        "scenarioId": "gt-1",
        "codeSha": code_sha,
        "configVersion": config_version,
        "startedAt": "2026-09-15T06:00:00Z",
        "durationMs": 10.0,
        "passed": True,
        "scope": "smoke",
        "categories": [{"id": "route", "title": "Route", "scenarios": 1, "passed": 1, "failed": 0}],
    }


class QaRunnerTests(unittest.TestCase):
    def test_real_runner_executes_existing_core_smoke_with_provenance(self) -> None:
        with patch.dict(os.environ, {"BLUEWOLF_CODE_SHA": "test-sha-123"}, clear=False):
            result = run_deterministic_qa(
                {
                    "scenarioId": "deterministic-core",
                    "configVersion": "cfg-17",
                    "scope": "smoke",
                }
            )
        self.assertEqual(result["schemaVersion"], QA_RUN_SCHEMA_VERSION)
        self.assertEqual(result["scenarioId"], "deterministic-core")
        self.assertEqual(result["codeSha"], "test-sha-123")
        self.assertEqual(result["configVersion"], "cfg-17")
        self.assertEqual(result["scope"], "smoke")
        self.assertGreater(result["durationMs"], 0)
        self.assertEqual(
            {category["id"] for category in result["categories"]},
            {"scoring", "determinism"},
        )
        for category in result["categories"]:
            self.assertEqual(category["passed"] + category["failed"], category["scenarios"])
        self.assertTrue(any(item["name"] == "batch_increment_equivalence" for item in result["details"]))
        self.assertFalse(any(item["name"] == "core_envelope_150_vehicles" for item in result["details"]))

    def test_invalid_scope_is_rejected_not_silently_downgraded(self) -> None:
        with self.assertRaisesRegex(ValueError, "scope"):
            run_deterministic_qa({"scope": "pretend-fast"})


class QaServiceTests(unittest.TestCase):
    def _runtime_env(self):
        return patch.dict(
            os.environ,
            {
                "BLUEWOLF_CODE_SHA": "sha-fixed",
                "GITHUB_SHA": "",
                "BLUEWOLF_CONFIG_VERSION": "cfg-runtime",
                "BLUEWOLF_OPERATIONAL_CONFIG": "",
            },
            clear=False,
        )

    def test_qa_endpoint_requires_same_bearer_token_boundary(self) -> None:
        async def base(scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        app = QaEnabledASGI(base, token="secret")
        status, payload = asyncio.run(_request(app, "/v1/qa/run"))
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")

    def test_provenance_endpoint_exposes_runtime_owned_code_and_config(self) -> None:
        async def base(scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        app = QaEnabledASGI(base, token="secret")
        with self._runtime_env(), patch("bluewolf_runtime_adapter.qa_service.service.operational_host", None):
            status, payload = asyncio.run(_request(app, "/v1/provenance", method="GET", token="secret"))
        self.assertEqual(status, 200)
        self.assertEqual(payload, {
            "schemaVersion": "bluewolf.runtime-provenance.v1",
            "codeSha": "sha-fixed",
            "configVersion": "cfg-runtime",
        })

    def test_qa_endpoint_overrides_client_config_with_runtime_provenance(self) -> None:
        async def base(scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        app = QaEnabledASGI(base, token="secret")
        captured = {}

        def runner(request):
            captured.update(request)
            return _qa_result()

        with self._runtime_env(), patch("bluewolf_runtime_adapter.qa_service.service.operational_host", None), patch(
            "bluewolf_runtime_adapter.qa_service.run_deterministic_qa",
            side_effect=runner,
        ):
            status, payload = asyncio.run(
                _request(
                    app,
                    "/v1/qa/run",
                    payload={"scenarioId": "gt-1", "configVersion": "client-fake", "scope": "smoke"},
                    token="secret",
                )
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload, _qa_result())
        self.assertEqual(captured["configVersion"], "cfg-runtime")
        self.assertNotEqual(captured["configVersion"], "client-fake")

    def test_qa_endpoint_fails_closed_when_runtime_provenance_is_missing(self) -> None:
        async def base(scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        app = QaEnabledASGI(base, token="secret")
        missing_env = {
            "BLUEWOLF_CODE_SHA": "",
            "GITHUB_SHA": "",
            "BLUEWOLF_CONFIG_VERSION": "",
            "BLUEWOLF_OPERATIONAL_CONFIG": "",
        }
        with patch.dict(os.environ, missing_env, clear=False), patch("bluewolf_runtime_adapter.qa_service.service.operational_host", None), patch(
            "bluewolf_runtime_adapter.qa_service.run_deterministic_qa"
        ) as runner:
            status, payload = asyncio.run(
                _request(app, "/v1/qa/run", payload={"scenarioId": "gt-1", "scope": "smoke"}, token="secret")
            )
        self.assertEqual(status, 503)
        self.assertIn("provenance", payload["error"])
        runner.assert_not_called()

    def test_qa_endpoint_rejects_runner_provenance_mismatch(self) -> None:
        async def base(scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        app = QaEnabledASGI(base, token="secret")
        with self._runtime_env(), patch("bluewolf_runtime_adapter.qa_service.service.operational_host", None), patch(
            "bluewolf_runtime_adapter.qa_service.run_deterministic_qa",
            return_value=_qa_result(code_sha="wrong-sha"),
        ):
            status, payload = asyncio.run(
                _request(app, "/v1/qa/run", payload={"scenarioId": "gt-1", "scope": "smoke"}, token="secret")
            )
        self.assertEqual(status, 500)
        self.assertIn("does not match runtime provenance", payload["error"])

    def test_qa_endpoint_returns_only_runner_payload_not_demo_fallback(self) -> None:
        async def base(scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        expected = _qa_result()
        app = QaEnabledASGI(base, token="secret")
        with self._runtime_env(), patch("bluewolf_runtime_adapter.qa_service.service.operational_host", None), patch(
            "bluewolf_runtime_adapter.qa_service.run_deterministic_qa",
            return_value=expected,
        ):
            status, payload = asyncio.run(
                _request(
                    app,
                    "/v1/qa/run",
                    payload={"scenarioId": "gt-1", "scope": "smoke"},
                    token="secret",
                )
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload, expected)

    def test_non_qa_paths_delegate_to_existing_runtime(self) -> None:
        async def base(scope, receive, send):
            del receive
            body = json.dumps({"delegated": scope["path"]}).encode()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": body})

        app = QaEnabledASGI(base)
        status, payload = asyncio.run(_request(app, "/healthz", method="GET"))
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"delegated": "/healthz"})


if __name__ == "__main__":
    unittest.main()
