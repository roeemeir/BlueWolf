from __future__ import annotations

import math
import time
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.application_analysis_v23 import build_analysis_history, derive_events


START = datetime(2026, 9, 6, 0, 0, tzinfo=UTC)


def _config() -> dict:
    return {
        "thresholds": {
            "siPositionFullDeg": 10,
            "siPositionZeroDeg": 30,
            "soPositionFullPct": 5,
            "soPositionZeroPct": 25,
            "periodFullPct": 5,
            "periodZeroPct": 20,
            "motionFullPct": 10,
            "motionZeroPct": 30,
            "routeDistanceFullPct": 5,
            "routeDistanceZeroPct": 30,
            "tangentFullDeg": 10,
            "tangentZeroDeg": 60,
            "curvatureFullPct": 10,
            "curvatureZeroPct": 100,
        },
        "weights": {
            "sync": {"position": 60, "period": 20, "motion": 20},
            "route": {"distance": 15, "tangent": 70, "curvature": 15},
            "total": {"sync": 75, "route": 25},
        },
        "siTemplate": {"family": "SI", "values": [45, 45, 45, 45, 45, 45, 45]},
        "soTemplate": {"family": "SO", "values": []},
        "groupingSettings": {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20},
    }


def _dataset_24h() -> dict:
    """About 69k NAV points: 8 vehicles at ten-second historical fidelity."""
    duration_seconds = 24 * 60 * 60
    step_seconds = 10
    radius = 100.0
    period = 240.0
    vehicle_ids = tuple(range(101, 109))
    samples: list[dict] = []
    for second in range(0, duration_seconds + 1, step_seconds):
        timestamp = START + timedelta(seconds=second)
        wire = timestamp.isoformat().replace("+00:00", "Z")
        for index, vehicle_id in enumerate(vehicle_ids):
            angle = 2.0 * math.pi * second / period + 2.0 * math.pi * index / len(vehicle_ids)
            x = radius * math.cos(angle)
            y = radius * math.sin(angle)
            omega = 2.0 * math.pi / period
            samples.append({
                "source": "simulation",
                "serverId": "1",
                "timestamp": wire,
                "vehicleId": vehicle_id,
                "active": True,
                "latitude": 31.8 + y / 111_320.0,
                "longitude": 34.8 + x / (111_320.0 * math.cos(math.radians(31.8))),
                "altitude": None,
                "velocityNorth": radius * omega * math.cos(angle),
                "velocityEast": -radius * omega * math.sin(angle),
                "x": x,
                "y": y,
            })
    end = START + timedelta(seconds=duration_seconds)
    return {
        "samples": samples,
        "provenance": {
            "source": "simulation",
            "serverId": "1",
            "from": START.isoformat().replace("+00:00", "Z"),
            "to": end.isoformat().replace("+00:00", "Z"),
            "latestSampleAt": samples[-1]["timestamp"],
            "sampleCount": len(samples),
            "vehicleCount": len(vehicle_ids),
            "samplingMedianSeconds": float(step_seconds),
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


class HistoricalReplayPerformanceV23Tests(unittest.TestCase):
    def test_24h_69k_points_120_frames_40min_route_history_stays_within_core_budget(self) -> None:
        dataset = _dataset_24h()
        self.assertGreaterEqual(len(dataset["samples"]), 69_000)
        self.assertLessEqual(len(dataset["samples"]), 70_000)

        started = time.perf_counter()
        history = build_analysis_history(dataset, _config(), max_frames=120, lookback_minutes=40)
        events = derive_events(history, _config()["thresholds"])
        elapsed = time.perf_counter() - started

        self.assertGreaterEqual(len(history), 100)
        self.assertLessEqual(len(history), 120)
        self.assertEqual(history[-1]["timestamp"], dataset["provenance"]["latestSampleAt"])
        self.assertTrue(all(frame["analysis"]["available"] for frame in history[-5:]))
        self.assertIsInstance(events, list)
        # Reserve at least ~35 s of the 60 s end-to-end budget for the source
        # query, CSV parsing, Join, HTTP serialization and UI rendering.
        self.assertLess(elapsed, 25.0, f"24h Core replay with 40m lookback took {elapsed:.2f}s")


if __name__ == "__main__":
    unittest.main()
