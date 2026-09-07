from __future__ import annotations

import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from bluewolf_core.live_analysis_v21 import LiveAnalysisSession


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


def _wire_time(second: int) -> str:
    return (START + timedelta(seconds=second)).isoformat().replace("+00:00", "Z")


def _dataset(second: int, *, vehicle_id: int = 101) -> dict:
    timestamp = _wire_time(second)
    sample = {
        "source": "simulation",
        "serverId": "1",
        "timestamp": timestamp,
        "vehicleId": vehicle_id,
        "active": True,
        "latitude": 31.8,
        "longitude": 34.8 + second / 10_000_000.0,
        "altitude": 0.0,
        "velocityNorth": 0.0,
        "velocityEast": 1.0,
        "x": float(second),
        "y": 0.0,
    }
    return {
        "samples": [sample],
        "provenance": {
            "source": "simulation",
            "serverId": "1",
            "from": timestamp,
            "to": timestamp,
            "latestSampleAt": timestamp,
            "sampleCount": 1,
            "vehicleCount": 1,
            "samplingMedianSeconds": 0.0,
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


class LiveAnalysisV21Tests(unittest.TestCase):
    def test_stale_batch_cannot_move_frontier_or_public_time_backwards(self) -> None:
        session = LiveAnalysisSession(_config())
        newest = session.ingest(_dataset(20))
        frontier = session.core.processed_until_utc
        self.assertEqual(frontier, START + timedelta(seconds=20))

        stale = session.ingest(_dataset(10, vehicle_id=201))

        self.assertEqual(session.core.processed_until_utc, frontier)
        latest = datetime.fromisoformat(stale.analysis["provenance"]["latestSampleAt"].replace("Z", "+00:00"))
        first_latest = datetime.fromisoformat(newest.analysis["provenance"]["latestSampleAt"].replace("Z", "+00:00"))
        self.assertGreaterEqual(latest, first_latest)

    def test_same_live_session_serializes_concurrent_out_of_order_batches(self) -> None:
        session = LiveAnalysisSession(_config())
        session.ingest(_dataset(5))

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(session.ingest, _dataset(20, vehicle_id=201)),
                pool.submit(session.ingest, _dataset(15, vehicle_id=301)),
            ]
            envelopes = [future.result(timeout=10) for future in futures]

        self.assertEqual(session.core.processed_until_utc, START + timedelta(seconds=20))
        self.assertEqual(len(session.samples), 3)
        for envelope in envelopes:
            latest = datetime.fromisoformat(envelope.analysis["provenance"]["latestSampleAt"].replace("Z", "+00:00"))
            self.assertGreaterEqual(latest, START + timedelta(seconds=15))


if __name__ == "__main__":
    unittest.main()
