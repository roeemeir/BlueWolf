from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.application_analysis_v18 import (
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
        "soTemplate": {"family": "SO", "values": [2], "soSpec": {"relations": ["opposite"]}},
        "groupingSettings": {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20},
    }


def _provenance(samples: list[dict], seconds: int, vehicle_count: int) -> dict:
    return {
        "source": "simulation",
        "serverId": "1",
        "from": START.isoformat().replace("+00:00", "Z"),
        "to": (START + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
        "latestSampleAt": (START + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
        "sampleCount": len(samples),
        "vehicleCount": vehicle_count,
        "samplingMedianSeconds": 1.0,
        "completenessPct": 100.0,
        "freshnessSeconds": 0.0,
        "warnings": [],
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
    return {"samples": samples, "provenance": _provenance(samples, seconds, 3)}


def _line(a: tuple[float, float], b: tuple[float, float], count: int = 36) -> list[tuple[float, float]]:
    return [
        (a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count)
        for i in range(count)
    ]


def _figure8_points() -> list[tuple[float, float]]:
    left_x, right_x, radius = -100.0, 100.0, 30.0
    first_leg = _line((left_x, radius), (right_x, -radius))
    right_turn = [
        (right_x + radius * math.cos(angle), radius * math.sin(angle))
        for angle in (-math.pi / 2 + math.pi * i / 40 for i in range(40))
    ]
    second_leg = _line((right_x, radius), (left_x, -radius))
    left_turn = [
        (left_x + radius * math.cos(angle), radius * math.sin(angle))
        for angle in (-math.pi / 2 - math.pi * i / 40 for i in range(40))
    ]
    return first_leg + right_turn + second_leg + left_turn


def _point_on_polyline(points: list[tuple[float, float]], phase: float) -> tuple[float, float]:
    lengths = [
        math.hypot(points[(index + 1) % len(points)][0] - points[index][0], points[(index + 1) % len(points)][1] - points[index][1])
        for index in range(len(points))
    ]
    total = sum(lengths)
    target = (phase % 1.0) * total
    for index, length in enumerate(lengths):
        if target <= length or index == len(lengths) - 1:
            a, b = points[index], points[(index + 1) % len(points)]
            ratio = 0.0 if length <= 1e-9 else max(0.0, min(1.0, target / length))
            return a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio
        target -= length
    return points[0]


def _figure8_dataset(seconds: int = 360) -> dict:
    points = _figure8_points()
    period = 120.0
    samples: list[dict] = []
    vehicles = ((111, 0.0), (211, 0.5))
    for second in range(seconds + 1):
        timestamp = START + timedelta(seconds=second)
        for vehicle_id, offset in vehicles:
            phase = second / period + offset
            x, y = _point_on_polyline(points, phase)
            nx, ny = _point_on_polyline(points, phase + 0.25 / period)
            east = (nx - x) / 0.25
            north = (ny - y) / 0.25
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
    return {"samples": samples, "provenance": _provenance(samples, seconds, 2)}


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

    def test_crossed_leg_hippodrome_is_figure8_in_active_envelope(self) -> None:
        analysis = analyze_navigation_dataset(_figure8_dataset(), _config())
        self.assertTrue(analysis["available"])
        self.assertEqual(sorted(analysis["groups"]["so"]["members"]), [111, 211])
        routes = {route["vehicleId"]: route for route in analysis["routes"]}
        self.assertEqual(routes[111]["kind"], "figure8")
        self.assertEqual(routes[211]["kind"], "figure8")
        self.assertTrue(routes[111]["geometry"]["crossedLegs"])
        self.assertTrue(routes[211]["geometry"]["crossedLegs"])
        self.assertEqual(analysis["groups"]["so"]["observedRelations"], ["opposite"])
        self.assertGreaterEqual(analysis["groups"]["so"]["score"]["sync"], 70)

    def test_figure8_uses_single_hippodrome_external_grouping_law(self) -> None:
        settings = {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20}
        evidence = so_pair_compatibility(
            {"kind": "figure8", "center": {"x": 0.0, "y": 0.0}, "radius": 25.0, "legLength": 100.0, "rotationDeg": 0.0, "crossedLegs": True},
            {"kind": "single", "center": {"x": 120.0, "y": 5.0}, "radius": 25.0, "legLength": 100.0, "rotationDeg": 5.0},
            settings,
        )
        self.assertTrue(evidence["valid"])

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
