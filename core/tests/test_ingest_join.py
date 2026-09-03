from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import FieldQuality
from bluewolf_ingest import (
    MetricName,
    RawMetricPoint,
    TemporalJoinError,
    join_metric_points,
)


START = datetime(2026, 1, 1, tzinfo=UTC)


def point(
    second: int,
    metric: MetricName,
    value: float | int | str | bool,
    *,
    server_id: int = 1,
    vehicle_number: int = 7,
) -> RawMetricPoint:
    return RawMetricPoint(
        source_time_utc=START + timedelta(seconds=second),
        server_id=server_id,
        vehicle_number=vehicle_number,
        metric=metric,
        value=value,
    )


def base_points(end_second: int = 2) -> list[RawMetricPoint]:
    return [
        point(0, MetricName.VEHICLE_IDENTIFIER, 107),
        point(0, MetricName.ACTIVE, "green"),
        point(0, MetricName.LATITUDE, 31.0),
        point(end_second, MetricName.LATITUDE, 33.0),
        point(0, MetricName.LONGITUDE, 34.0),
        point(end_second, MetricName.LONGITUDE, 36.0),
    ]


class TemporalJoinTests(unittest.TestCase):
    def test_exact_original_wins_and_between_points_are_interpolated(self) -> None:
        samples = join_metric_points(base_points())
        self.assertEqual(len(samples), 3)
        self.assertEqual(samples[0].latitude_deg, 31)
        self.assertEqual(samples[1].latitude_deg, 32)
        self.assertEqual(samples[2].longitude_deg, 36)
        self.assertIs(
            samples[0].field_quality[MetricName.LATITUDE.value],
            FieldQuality.ORIGINAL,
        )
        self.assertIs(
            samples[1].field_quality[MetricName.LATITUDE.value],
            FieldQuality.INTERPOLATED,
        )
        self.assertIs(
            samples[1].field_quality[MetricName.VEHICLE_IDENTIFIER.value],
            FieldQuality.FORWARD_FILLED,
        )
        self.assertEqual(samples[1].reliability, 0.95)

    def test_approximation_reliability_falls_linearly_to_75_percent(self) -> None:
        points = [
            point(0, MetricName.VEHICLE_IDENTIFIER, 107),
            point(0, MetricName.ACTIVE, True),
            point(0, MetricName.LATITUDE, 31),
            point(10, MetricName.LATITUDE, 32),
            point(0, MetricName.LONGITUDE, 34),
            point(10, MetricName.LONGITUDE, 35),
            point(5, MetricName.VEHICLE_IDENTIFIER, 107),
            point(5, MetricName.ACTIVE, True),
        ]
        samples = join_metric_points(
            points,
            start_time_utc=START + timedelta(seconds=5),
            end_time_utc=START + timedelta(seconds=5),
        )
        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0].reliability, 0.75)

    def test_identifier_is_not_backfilled_or_filled_beyond_five_seconds(self) -> None:
        points = [
            point(1, MetricName.VEHICLE_IDENTIFIER, 107),
            point(0, MetricName.ACTIVE, True),
            point(0, MetricName.LATITUDE, 31),
            point(7, MetricName.LATITUDE, 31.1),
            point(0, MetricName.LONGITUDE, 34),
            point(7, MetricName.LONGITUDE, 34.1),
        ]
        samples = join_metric_points(
            points, start_time_utc=START, end_time_utc=START + timedelta(seconds=7)
        )
        times = [(sample.sample_time_utc - START).total_seconds() for sample in samples]
        self.assertNotIn(0, times)
        self.assertNotIn(7, times)
        self.assertTrue(all(1 <= second <= 6 for second in times))

    def test_interpolation_never_crosses_identifier_change(self) -> None:
        points = base_points()
        points.append(point(2, MetricName.VEHICLE_IDENTIFIER, 207))
        samples = join_metric_points(points)
        self.assertEqual(
            [(sample.sample_time_utc - START).total_seconds() for sample in samples],
            [0, 2],
        )
        self.assertEqual([sample.vehicle_identifier for sample in samples], [107, 207])

    def test_interpolation_never_crosses_inactive_state(self) -> None:
        points = base_points()
        points.append(point(2, MetricName.ACTIVE, "red"))
        samples = join_metric_points(points)
        self.assertEqual(
            [(sample.sample_time_utc - START).total_seconds() for sample in samples],
            [0, 2],
        )
        self.assertTrue(samples[0].active)
        self.assertFalse(samples[1].active)

    def test_inactive_status_is_emitted_even_without_position(self) -> None:
        samples = join_metric_points(
            [
                point(0, MetricName.VEHICLE_IDENTIFIER, 107),
                point(0, MetricName.ACTIVE, "off"),
            ]
        )
        self.assertEqual(len(samples), 1)
        self.assertFalse(samples[0].active)
        self.assertIsNone(samples[0].latitude_deg)
        self.assertIsNone(samples[0].longitude_deg)

    def test_streams_are_never_joined_across_server_or_vehicle_number(self) -> None:
        points = base_points()
        points.extend(
            [
                point(0, MetricName.VEHICLE_IDENTIFIER, 208, vehicle_number=8),
                point(0, MetricName.ACTIVE, True, vehicle_number=8),
            ]
        )
        samples = join_metric_points(points)
        self.assertTrue(all(sample.vehicle_number == 7 for sample in samples))

    def test_conflicting_originals_at_same_time_are_rejected(self) -> None:
        points = base_points()
        points.append(point(0, MetricName.LATITUDE, 99))
        with self.assertRaises(TemporalJoinError):
            join_metric_points(points)

    def test_naive_join_bound_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            join_metric_points(base_points(), start_time_utc=datetime(2026, 1, 1))


if __name__ == "__main__":
    unittest.main()
