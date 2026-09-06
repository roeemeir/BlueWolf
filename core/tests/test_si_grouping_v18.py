from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.application_analysis_v18 import analyze_navigation_dataset

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


def _dataset(seconds: int = 180) -> dict:
    samples: list[dict] = []
    radius = 100.0
    period = 120.0
    omega = 2.0 * math.pi / period
    vehicles = (
        (101, 0.0, 0.0, 0.0),
        (201, 120.0, 0.0, 0.0),
        (301, 240.0, 0.0, 0.0),
        # A valid circular track, but on a remote centre. It must not erase
        # the three-vehicle SI component above.
        (901, 45.0, 650.0, 0.0),
    )
    for second in range(seconds + 1):
        timestamp = START + timedelta(seconds=second)
        for vehicle_id, phase_deg, center_x, center_y in vehicles:
            angle = 2.0 * math.pi * second / period + math.radians(phase_deg)
            local_x = radius * math.cos(angle)
            local_y = radius * math.sin(angle)
            x = center_x + local_x
            y = center_y + local_y
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
            "to": (START + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
            "latestSampleAt": (START + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
            "sampleCount": len(samples),
            "vehicleCount": 4,
            "samplingMedianSeconds": 1.0,
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


class SiGroupingV18Tests(unittest.TestCase):
    def test_remote_circle_outlier_does_not_erase_valid_si_group(self) -> None:
        analysis = analyze_navigation_dataset(_dataset(), _config())
        self.assertTrue(analysis["available"])
        self.assertEqual(sorted(analysis["groups"]["si"]["members"]), [101, 201, 301])
        self.assertNotIn(901, analysis["groups"]["si"]["members"])
        self.assertGreaterEqual(analysis["groups"]["si"]["score"]["sync"], 80)


if __name__ == "__main__":
    unittest.main()
