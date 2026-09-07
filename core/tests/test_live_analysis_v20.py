from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import bluewolf_core.live_analysis_v20 as live_v20


START = datetime(2026, 9, 7, 0, 0, tzinfo=UTC)


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


def _dataset() -> dict:
    samples: list[dict] = []
    radius = 100.0
    period = 120.0
    for second in range(0, 1801, 5):
        timestamp = START + timedelta(seconds=second)
        for vehicle_id, offset_deg in ((101, 0.0), (201, 120.0), (301, 240.0)):
            angle = 2.0 * math.pi * second / period + math.radians(offset_deg)
            x = radius * math.cos(angle)
            y = radius * math.sin(angle)
            omega = 2.0 * math.pi / period
            samples.append({
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
    return {
        "samples": samples,
        "provenance": {
            "source": "simulation",
            "serverId": "1",
            "from": START.isoformat().replace("+00:00", "Z"),
            "to": (START + timedelta(seconds=1800)).isoformat().replace("+00:00", "Z"),
            "latestSampleAt": (START + timedelta(seconds=1800)).isoformat().replace("+00:00", "Z"),
            "sampleCount": len(samples),
            "vehicleCount": 3,
            "samplingMedianSeconds": 5.0,
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class LiveAnalysisV20Tests(unittest.TestCase):
    def test_selected_30_min_window_keeps_full_provenance_but_current_fit_is_15_min(self) -> None:
        dataset = _dataset()
        observed_datasets: list[dict] = []
        real_analyze = live_v20.analyze_navigation_dataset

        def spy(current_dataset: dict, config: dict) -> dict:
            observed_datasets.append(current_dataset)
            return real_analyze(current_dataset, config)

        with patch.object(live_v20, "analyze_navigation_dataset", side_effect=spy):
            envelope = live_v20.LiveAnalysisSession(_config()).ingest(dataset)

        self.assertTrue(observed_datasets)
        current = observed_datasets[0]
        current_from = _time(current["provenance"]["from"])
        current_to = _time(current["provenance"]["to"])
        self.assertLessEqual((current_to - current_from).total_seconds(), 15 * 60)
        self.assertEqual(_time(envelope.analysis["provenance"]["from"]), _time(dataset["provenance"]["from"]))
        self.assertEqual(envelope.analysis["provenance"]["sampleCount"], len(dataset["samples"]))
        self.assertEqual(sorted(envelope.analysis["groups"]["si"]["members"]), [101, 201, 301])


if __name__ == "__main__":
    unittest.main()
