from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from bluewolf_core import application_analysis_v19 as v19


SETTINGS = {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20.0}


def point(origin: tuple[float, float], axis_deg: float, distance: float) -> tuple[float, float]:
    angle = math.radians(axis_deg)
    return origin[0] + math.cos(angle) * distance, origin[1] + math.sin(angle) * distance


def line_samples(
    start: tuple[float, float],
    end: tuple[float, float],
    axis_deg: float,
    *,
    count: int,
    start_index: int,
) -> list[dict[str, object]]:
    ux = math.cos(math.radians(axis_deg))
    uy = math.sin(math.radians(axis_deg))
    started = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
    output: list[dict[str, object]] = []
    for index in range(count):
        fraction = index / max(1, count - 1)
        x = start[0] + (end[0] - start[0]) * fraction
        y = start[1] + (end[1] - start[1]) * fraction
        output.append({
            "x": x,
            "y": y,
            "velocityEast": ux * 8.0,
            "velocityNorth": uy * 8.0,
            "timestamp": (started + timedelta(seconds=start_index + index)).isoformat().replace("+00:00", "Z"),
            "active": True,
            "vehicleId": 1,
            "latitude": 31.7,
            "longitude": 34.8,
        })
    return output


class SoGroupingV19Tests(unittest.TestCase):
    def test_articulated_double_uses_both_nav_arms_for_single_connection(self) -> None:
        joint = (0.0, 0.0)
        outer_a = point(joint, 180.0, 118.0)
        outer_b = point(joint, 48.0, 106.0)
        samples = [
            *line_samples(outer_a, joint, 0.0, count=12, start_index=0),
            *line_samples(joint, outer_b, 48.0, count=12, start_index=12),
        ]
        fit = v19._base._pca(samples)
        double_track = SimpleNamespace(
            vehicle_id=611,
            kind="double",
            samples=samples,
            fit=fit,
            # Deliberately poor PCA-style approximation: the regression proves
            # grouping comes from raw-NAV arms rather than this fixed bend.
            geometry={
                "kind": "double",
                "center": {"x": 10.0, "y": 8.0},
                "radius": 25.0,
                "legLength": 80.0,
                "secondLegLength": 80.0,
                "bendDeg": 28.0,
                "rotationDeg": 15.0,
            },
        )

        single_outer = point(outer_b, 48.0, 92.0)
        single_center = ((outer_b[0] + single_outer[0]) / 2.0, (outer_b[1] + single_outer[1]) / 2.0)
        single_track = SimpleNamespace(
            vehicle_id=613,
            kind="single",
            samples=[],
            fit=SimpleNamespace(),
            geometry={
                "kind": "single",
                "center": {"x": single_center[0], "y": single_center[1]},
                "radius": 24.0,
                "legLength": 92.0,
                "rotationDeg": 48.0,
            },
        )

        learned = v19._track_grouping_geometries(double_track)
        self.assertEqual(len(learned), 2)
        evidence = v19._track_pair_evidence(double_track, single_track, SETTINGS)
        self.assertTrue(evidence["valid"], evidence["explanation"])
        self.assertIn("Double-arm NAV", evidence["explanation"])

    def test_component_groups_connected_double_and_single(self) -> None:
        joint = (0.0, 0.0)
        outer_a = point(joint, 180.0, 110.0)
        outer_b = point(joint, 42.0, 100.0)
        samples = [
            *line_samples(outer_a, joint, 0.0, count=12, start_index=0),
            *line_samples(joint, outer_b, 42.0, count=12, start_index=12),
        ]
        double = SimpleNamespace(
            vehicle_id=1,
            kind="double",
            samples=samples,
            fit=v19._base._pca(samples),
            geometry={"kind": "double", "center": {"x": 0.0, "y": 0.0}, "radius": 25.0, "legLength": 80.0, "secondLegLength": 80.0, "bendDeg": 28.0, "rotationDeg": 12.0},
        )
        far = point(outer_b, 42.0, 90.0)
        center = ((outer_b[0] + far[0]) / 2.0, (outer_b[1] + far[1]) / 2.0)
        single = SimpleNamespace(
            vehicle_id=2,
            kind="single",
            samples=[],
            fit=SimpleNamespace(),
            geometry={"kind": "single", "center": {"x": center[0], "y": center[1]}, "radius": 24.0, "legLength": 90.0, "rotationDeg": 42.0},
        )
        grouped, discarded, evidence = v19._largest_compatible_component_v19([double, single], SETTINGS)
        self.assertEqual([track.vehicle_id for track in grouped], [1, 2])
        self.assertEqual(discarded, [])
        self.assertTrue(evidence["0:1"]["valid"])


if __name__ == "__main__":
    unittest.main()
