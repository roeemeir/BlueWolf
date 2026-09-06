from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.live_analysis import LiveAnalysisSession


START = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)


def _config() -> dict:
    return {
        "thresholds": {
            "siPositionFullDeg": 10, "siPositionZeroDeg": 30,
            "soPositionFullPct": 5, "soPositionZeroPct": 25,
            "periodFullPct": 5, "periodZeroPct": 20,
            "motionFullPct": 10, "motionZeroPct": 30,
            "routeDistanceFullPct": 5, "routeDistanceZeroPct": 30,
            "tangentFullDeg": 10, "tangentZeroDeg": 60,
            "curvatureFullPct": 10, "curvatureZeroPct": 100,
            "lowSpeedPct": 30, "smoothingSeconds": 10,
            "greenScore": 80, "redScore": 50,
        },
        "weights": {
            "sync": {"position": 60, "period": 20, "motion": 20},
            "route": {"distance": 15, "tangent": 70, "curvature": 15},
            "total": {"sync": 75, "route": 25},
        },
        "siTemplate": {"family": "SI", "values": [120, 120]},
        "soTemplate": {"family": "SO", "values": [2], "soSpec": {"relations": ["opposite"]}},
        "groupingSettings": {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20},
    }


def _samples(start_second: int, end_second: int) -> list[dict]:
    output: list[dict] = []
    radius = 100.0
    period = 120.0
    for second in range(start_second, end_second + 1):
        timestamp = START + timedelta(seconds=second)
        for vehicle_id, offset_deg in ((101, 0.0), (201, 120.0), (301, 240.0)):
            angle = 2.0 * math.pi * second / period + math.radians(offset_deg)
            x = radius * math.cos(angle)
            y = radius * math.sin(angle)
            omega = 2.0 * math.pi / period
            output.append({
                "source": "simulation",
                "serverId": "1",
                "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
                "vehicleId": vehicle_id,
                "active": True,
                "latitude": 31.8 + y / 111_320.0,
                "longitude": 34.8 + x / (111_320.0 * math.cos(math.radians(31.8))),
                "altitude": 0.0,
                "velocityNorth": radius * omega * math.cos(angle),
                "velocityEast": -radius * omega * math.sin(angle),
                "x": x,
                "y": y,
            })
    return output


def _dataset(start_second: int, end_second: int) -> dict:
    samples = _samples(start_second, end_second)
    return {
        "samples": samples,
        "provenance": {
            "source": "simulation",
            "serverId": "1",
            "from": (START + timedelta(seconds=start_second)).isoformat().replace("+00:00", "Z"),
            "to": (START + timedelta(seconds=end_second)).isoformat().replace("+00:00", "Z"),
            "latestSampleAt": (START + timedelta(seconds=end_second)).isoformat().replace("+00:00", "Z"),
            "sampleCount": len(samples),
            "vehicleCount": 3,
            "samplingMedianSeconds": 1.0,
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


class LiveAnalysisV18Tests(unittest.TestCase):
    def test_warmup_then_five_second_batch_accepts_only_new_samples(self) -> None:
        session = LiveAnalysisSession(_config())
        warmup = session.ingest(_dataset(0, 180))
        self.assertEqual(warmup.accepted_samples, 181 * 3)
        incremental = session.ingest(_dataset(176, 185))
        self.assertEqual(incremental.accepted_samples, 5 * 3)
        self.assertEqual(sorted(incremental.analysis["groups"]["si"]["members"]), [101, 201, 301])
        self.assertEqual(incremental.analysis["provenance"]["latestSampleAt"], (START + timedelta(seconds=185)).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    def test_incremental_analysis_matches_same_final_navigation_window(self) -> None:
        incremental = LiveAnalysisSession(_config())
        incremental.ingest(_dataset(0, 180))
        final_incremental = incremental.ingest(_dataset(181, 185)).analysis

        one_shot = LiveAnalysisSession(_config())
        final_one_shot = one_shot.ingest(_dataset(0, 185)).analysis
        self.assertEqual(final_incremental["groups"], final_one_shot["groups"])
        self.assertEqual(final_incremental["routes"], final_one_shot["routes"])
        self.assertEqual(final_incremental["current"], final_one_shot["current"])

    def test_checkpoint_excludes_display_nav_and_restore_uses_replay(self) -> None:
        session = LiveAnalysisSession(_config())
        session.ingest(_dataset(0, 360))
        checkpoint = session.checkpoint()
        restored, envelope = LiveAnalysisSession.restore(
            checkpoint,
            app_config=_config(),
            recovery_dataset=_dataset(300, 360),
        )
        self.assertEqual(restored.core.processed_until_utc, session.core.processed_until_utc)
        self.assertTrue(envelope.analysis["available"])
        self.assertLess(len(restored.samples), len(session.samples))

    def test_restore_replays_samples_after_checkpoint_frontier(self) -> None:
        original = LiveAnalysisSession(_config())
        original.ingest(_dataset(0, 360))
        checkpoint = original.checkpoint()
        uninterrupted = original.ingest(_dataset(361, 365))

        restored, recovered = LiveAnalysisSession.restore(
            checkpoint,
            app_config=_config(),
            recovery_dataset=_dataset(300, 365),
        )
        self.assertEqual(restored.core.processed_until_utc, START + timedelta(seconds=365))
        self.assertEqual(recovered.accepted_samples, 5 * 3)
        self.assertEqual(recovered.analysis["groups"], uninterrupted.analysis["groups"])
        self.assertEqual(recovered.analysis["current"], uninterrupted.analysis["current"])


if __name__ == "__main__":
    unittest.main()
