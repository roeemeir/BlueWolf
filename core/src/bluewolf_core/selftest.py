"""Deterministic foundation self-test with a machine-readable summary."""

from __future__ import annotations

import json
import time
import tracemalloc
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Callable

from .models import PrimitiveMetrics, RouteFamily
from .scoring import score_vehicle
from .session import CoreSession
from .simulator import SimulatedVehicle, generate_si_circle_samples


class CheckStatus(StrEnum):
    PASSED = "passed"
    BORDERLINE = "borderline"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class CheckResult:
    name: str
    status: CheckStatus
    summary: str
    metrics: dict[str, float | int | str]


@dataclass(frozen=True, slots=True)
class SelfTestReport:
    scope: str
    overall_status: CheckStatus
    generated_at_utc: str
    algorithm_version: str
    checks: tuple[CheckResult, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


def _capture(name: str, action: Callable[[], CheckResult]) -> CheckResult:
    try:
        return action()
    except Exception as error:  # self-test must report all failures, not stop at the first
        return CheckResult(
            name=name,
            status=CheckStatus.FAILED,
            summary=f"unexpected {type(error).__name__}: {error}",
            metrics={},
        )


def _ideal_score_check() -> CheckResult:
    score = score_vehicle(
        PrimitiveMetrics(
            family=RouteFamily.SI,
            position_error=0,
            period_error_ratio=0,
            movement_error_ratio=0,
            distance_error_b_ratio=0,
            tangent_error_deg=0,
            curvature_error_ratio=0,
            reliability=1,
            speed_fraction=1,
        )
    )
    passed = score.valid and score.sync == score.route == score.total == 100
    return CheckResult(
        name="approved_scoring_contract",
        status=CheckStatus.PASSED if passed else CheckStatus.FAILED,
        summary="approved score weights and zero-error bands" if passed else "unexpected ideal score",
        metrics={
            "sync": float(score.sync or 0),
            "route": float(score.route or 0),
            "total": float(score.total or 0),
        },
    )


def _equivalence_check() -> CheckResult:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    samples = generate_si_circle_samples(
        start_time_utc=start,
        duration_seconds=60,
        vehicles=(
            SimulatedVehicle(1, 101, 0),
            SimulatedVehicle(2, 102, 120),
            SimulatedVehicle(3, 103, 240),
        ),
        position_noise_std_m=1.0,
        seed=8842,
    )
    batch = CoreSession()
    expected = batch.process_batch(samples)

    incremental = CoreSession()
    frames = []
    changes = []
    for window_start in range(0, 61, 5):
        window_end = window_start + 5
        part = tuple(
            sample
            for sample in samples
            if window_start
            <= (sample.sample_time_utc - start).total_seconds()
            < window_end
        )
        result = incremental.process_batch(part)
        frames.extend(result.frames)
        changes.extend(result.changes)

    equivalent = (
        tuple(frames) == expected.frames
        and tuple(changes) == expected.changes
        and incremental.export_checkpoint() == batch.export_checkpoint()
    )
    return CheckResult(
        name="batch_increment_equivalence",
        status=CheckStatus.PASSED if equivalent else CheckStatus.FAILED,
        summary="one batch and 5-second increments are byte-equivalent" if equivalent else "results differ",
        metrics={"samples": len(samples), "increment_seconds": 5},
    )


def _restart_check() -> CheckResult:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    samples = generate_si_circle_samples(
        start_time_utc=start,
        duration_seconds=60,
        vehicles=(SimulatedVehicle(1, 101, 0), SimulatedVehicle(2, 102, 180)),
        seed=2,
    )
    split = start + timedelta(seconds=30)
    head = tuple(sample for sample in samples if sample.sample_time_utc <= split)
    tail = tuple(sample for sample in samples if sample.sample_time_utc > split)

    continuous = CoreSession()
    continuous.process_batch(head)
    expected = continuous.process_batch(tail)

    stopped = CoreSession()
    stopped.process_batch(head)
    restored = CoreSession.from_checkpoint(stopped.export_checkpoint())
    actual = restored.process_batch(tail)
    equivalent = (
        actual == expected
        and restored.export_checkpoint() == continuous.export_checkpoint()
    )
    return CheckResult(
        name="checkpoint_restart_equivalence",
        status=CheckStatus.PASSED if equivalent else CheckStatus.FAILED,
        summary="restart continues without changing results" if equivalent else "restart changed results",
        metrics={"checkpoint_interval_seconds": 300, "split_at_seconds": 30},
    )


def _capacity_check() -> CheckResult:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    samples = []
    for server_id in range(1, 11):
        vehicles = tuple(
            SimulatedVehicle(number, server_id * 10_000 + number, number * 24)
            for number in range(1, 16)
        )
        samples.extend(
            generate_si_circle_samples(
                start_time_utc=start,
                duration_seconds=300,
                vehicles=vehicles,
                server_id=server_id,
                sample_interval_seconds=1,
                position_noise_std_m=0.25,
                seed=server_id,
            )
        )

    tracemalloc.start()
    started = time.perf_counter()
    session = CoreSession()
    result = session.process_batch(samples)
    elapsed = time.perf_counter() - started
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    real_time_ratio = elapsed / 300.0
    if real_time_ratio <= 0.25:
        status = CheckStatus.PASSED
    elif real_time_ratio <= 1.0:
        status = CheckStatus.BORDERLINE
    else:
        status = CheckStatus.FAILED
    return CheckResult(
        name="core_envelope_150_vehicles",
        status=status,
        summary="state/session envelope only; route algorithms are measured in later milestones",
        metrics={
            "servers": 10,
            "vehicles": 150,
            "scenario_seconds": 300,
            "samples": len(result.frames),
            "processing_seconds": round(elapsed, 6),
            "real_time_ratio": round(real_time_ratio, 6),
            "peak_memory_mb": round(peak_bytes / 1_048_576, 3),
        },
    )


def run_self_test(algorithm_version: str = "0.1.0") -> SelfTestReport:
    checks = (
        _capture("approved_scoring_contract", _ideal_score_check),
        _capture("batch_increment_equivalence", _equivalence_check),
        _capture("checkpoint_restart_equivalence", _restart_check),
        _capture("core_envelope_150_vehicles", _capacity_check),
    )
    statuses = {check.status for check in checks}
    overall = (
        CheckStatus.FAILED
        if CheckStatus.FAILED in statuses
        else CheckStatus.BORDERLINE
        if CheckStatus.BORDERLINE in statuses
        else CheckStatus.PASSED
    )
    return SelfTestReport(
        scope="foundation only: contracts, scoring, session, checkpoint and load envelope",
        overall_status=overall,
        generated_at_utc=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        algorithm_version=algorithm_version,
        checks=checks,
    )
