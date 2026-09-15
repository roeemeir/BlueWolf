"""Truth-backed deterministic QA adapter over the real Blue Wolf core.

This module does not implement parallel scoring/detection logic. It executes the
existing deterministic core self-test, then serializes those observed outcomes
into the application-facing QA contract used by the developer UI.
"""
from __future__ import annotations

from datetime import UTC, datetime
import os
from time import perf_counter
from typing import Any, Mapping
from uuid import uuid4

from bluewolf_core.selftest import CheckResult, CheckStatus, run_self_test

QA_RUN_SCHEMA_VERSION = "bluewolf.qa-run.v1"


def _code_version() -> str:
    return (
        os.environ.get("BLUEWOLF_CODE_SHA", "").strip()
        or os.environ.get("GITHUB_SHA", "").strip()
        or "unknown"
    )


def _category(category_id: str, title: str, checks: tuple[CheckResult, ...]) -> dict[str, Any]:
    passed = sum(check.status is CheckStatus.PASSED for check in checks)
    failed = len(checks) - passed
    return {
        "id": category_id,
        "title": title,
        "scenarios": len(checks),
        "passed": passed,
        "failed": failed,
    }


def run_deterministic_qa(request: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Execute real deterministic core checks and return a versioned QA record."""

    payload = dict(request or {})
    scenario_id = str(payload.get("scenarioId") or "full-regression")[:120]
    config_version = str(payload.get("configVersion") or "unknown")[:120]
    started_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    started = perf_counter()
    report = run_self_test(algorithm_version=_code_version())
    duration_ms = (perf_counter() - started) * 1000.0
    checks = {check.name: check for check in report.checks}

    scoring = tuple(
        check for name in ("approved_scoring_contract",) if (check := checks.get(name)) is not None
    )
    determinism = tuple(
        check
        for name in ("batch_increment_equivalence", "checkpoint_restart_equivalence")
        if (check := checks.get(name)) is not None
    )
    capacity = tuple(
        check for name in ("core_envelope_150_vehicles",) if (check := checks.get(name)) is not None
    )
    categories = [
        _category("scoring", "Scoring contract", scoring),
        _category("determinism", "Batch / incremental / restart equivalence", determinism),
        _category("capacity", "Core capacity envelope", capacity),
    ]
    # BORDERLINE is not silently converted to pass: only PASSED counts as passed.
    overall_passed = report.overall_status is CheckStatus.PASSED
    return {
        "schemaVersion": QA_RUN_SCHEMA_VERSION,
        "runId": f"qa-{uuid4().hex}",
        "scenarioId": scenario_id,
        "codeSha": _code_version(),
        "configVersion": config_version,
        "startedAt": started_at,
        "durationMs": round(duration_ms, 3),
        "passed": overall_passed,
        "categories": categories,
        "details": [
            {
                "name": check.name,
                "status": check.status.value,
                "summary": check.summary,
                "metrics": dict(check.metrics),
            }
            for check in report.checks
        ],
    }


__all__ = ["QA_RUN_SCHEMA_VERSION", "run_deterministic_qa"]
