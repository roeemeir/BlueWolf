from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.application_analysis import (
    CORE_API_VERSION,
    analyze_navigation_dataset,
    build_analysis_history,
    derive_events,
    so_pair_compatibility,
)
from bluewolf_core.worker import CoreWorker


START = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)


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
        "siTemplate": {"family": "SI", "values": [120, 120]},
        "soTemplate": {"family": "SO", "values": [2, 0], "soSpec": {"relations": ["opposite", "same"]}},
        "groupingSettings": {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20},
    }


def _circle_dataset(seconds: int = 180) -> dict:
    samples = []
    radius = 100.0
    period = 120.0
    vehicles = ((101, 0.0), (201, 120.0), (301, 240.0))
    for second in range(seconds + 1):
        timestamp = START + timedelta(seconds=second)
        for vehicle_id, offset_deg in vehicles:
            angle = 2.0 * math.pi * second / period + math.radians(offset_deg)
            x = radius * math.cos(angle)
            y = radius * math.sin(angle)
            omega = 2.0 * math.pi / period
            east = -radius * omega * math.sin(angle)
            north = radius * omega * math.cos(angle)
            samples.append({
                "source": "simulation",
                "serverId": "1",
                "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
                "vehicleId": vehicle_id,
                "active": True,
                "latitude": 31.8 + y / 111_320.0,
                "longitude": 34.8 + x / (111_320.0 * math.cos(math.radians(31.8))),
                "altitude": 0.0,
                "velocityNorth": north,
                "velocityEast": east,
                "x": x,
                "y": y,
            })
    return {
        "samples": samples,
        "provenance": {
            "source": "simulation",
            "serverId": "1",
            "from": START.isoformat().replace("+00:00", "Z"),
            "to": (START + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
            "latestSampleAt": (START + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
            "sampleCount": len(samples),
            "vehicleCount": 3,
            "samplingMedianSeconds": 1.0,
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


class ApplicationAnalysisTests(unittest.TestCase):
    def test_clean_circle_is_high_scoring_and_deterministic(self) -> None:
        dataset = _circle_dataset()
        first = analyze_navigation_dataset(dataset, _config())
        second = analyze_navigation_dataset(dataset, _config())
        self.assertEqual(first, second)
        self.assertEqual(first["coreApiVersion"], CORE_API_VERSION)
        self.assertTrue(first["available"])
        self.assertEqual(sorted(first["groups"]["si"]["members"]), [101, 201, 301])
        self.assertGreaterEqual(first["groups"]["si"]["score"]["sync"], 85)
        self.assertGreaterEqual(first["groups"]["si"]["score"]["total"], 80)

    def test_no_navigation_never_fabricates_a_group_or_score(self) -> None:
        dataset = {
            "samples": [],
            "provenance": {
                "source": "influx",
                "serverId": "1",
                "from": START.isoformat().replace("+00:00", "Z"),
                "to": START.isoformat().replace("+00:00", "Z"),
                "latestSampleAt": None,
                "sampleCount": 0,
                "vehicleCount": 0,
                "samplingMedianSeconds": None,
                "completenessPct": None,
                "freshnessSeconds": None,
                "warnings": ["no data"],
            },
        }
        analysis = analyze_navigation_dataset(dataset, _config())
        self.assertFalse(analysis["available"])
        self.assertEqual(analysis["groups"]["si"]["members"], [])
        self.assertEqual(analysis["groups"]["so"]["members"], [])
        self.assertEqual(analysis["groups"]["si"]["score"]["total"], 0)
        self.assertEqual(analysis["alerts"][0]["id"], "no-data")

    def test_so_projection_grouping_matches_current_geometry_law(self) -> None:
        settings = {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20}
        valid = so_pair_compatibility(
            {"kind": "single", "center": {"x": 0.0, "y": 0.0}, "radius": 25.0, "legLength": 100.0, "rotationDeg": 0.0},
            {"kind": "single", "center": {"x": 120.0, "y": 5.0}, "radius": 25.0, "legLength": 100.0, "rotationDeg": 5.0},
            settings,
        )
        invalid = so_pair_compatibility(
            {"kind": "single", "center": {"x": 0.0, "y": 0.0}, "radius": 25.0, "legLength": 100.0, "rotationDeg": 0.0},
            {"kind": "single", "center": {"x": 90.0, "y": 70.0}, "radius": 25.0, "legLength": 100.0, "rotationDeg": 45.0},
            settings,
        )
        self.assertTrue(valid["valid"])
        self.assertFalse(invalid["valid"])

    def test_history_events_and_worker_use_same_python_analysis(self) -> None:
        dataset = _circle_dataset(360)
        history = build_analysis_history(dataset, _config(), max_frames=12, lookback_minutes=3)
        self.assertGreater(len(history), 1)
        events = derive_events(history, _config()["thresholds"])
        self.assertTrue(events)
        worker = CoreWorker()
        direct = analyze_navigation_dataset(dataset, _config())
        response = worker.handle({"command": "analyze_dataset", "dataset": dataset, "config": _config()})
        self.assertEqual(response["analysis"], direct)
        history_response = worker.handle({"command": "analyze_history", "dataset": dataset, "config": _config(), "maxFrames": 12, "lookbackMinutes": 3})
        self.assertEqual(history_response["history"], history)
        self.assertEqual(history_response["events"], events)


if __name__ == "__main__":
    unittest.main()
