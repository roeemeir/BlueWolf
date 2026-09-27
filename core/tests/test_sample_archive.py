from __future__ import annotations

from datetime import UTC, datetime, timedelta
import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path

from bluewolf_core.models import FieldQuality, VehicleSample
from bluewolf_runtime_adapter.sample_archive import JoinedSampleArchive


NOW = datetime(2026, 9, 9, 20, 0, tzinfo=UTC)


def _sample(
    at: datetime = NOW,
    *,
    vehicle_id: int = 11,
    latitude: float = 32.0,
    reliability: float = 0.9,
) -> VehicleSample:
    return VehicleSample(
        sample_time_utc=at,
        server_id=1,
        vehicle_number=vehicle_id,
        vehicle_identifier=vehicle_id,
        active=True,
        latitude_deg=latitude,
        longitude_deg=34.8,
        altitude_m=100.0,
        velocity_north_mps=1.0,
        velocity_east_mps=2.0,
        reliability=reliability,
        field_quality={
            "latitude_deg": FieldQuality.ORIGINAL,
            "longitude_deg": FieldQuality.INTERPOLATED,
            "active": FieldQuality.FORWARD_FILLED,
        },
    )


class JoinedSampleArchiveTests(unittest.TestCase):
    def test_streamed_batches_match_window_for_all_batch_sizes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = JoinedSampleArchive(Path(directory) / "samples.sqlite")
            archive.record_batch(
                [_sample(NOW + timedelta(seconds=i), vehicle_id=j)
                 for i in range(13) for j in (11, 12)], recorded_at_utc=NOW,
            )
            query = dict(server_id=1, start_time_utc=NOW,
                         end_time_utc=NOW + timedelta(seconds=12))
            expected = archive.read_latest_window(**query)
            self.assertEqual(len(expected), 26)
            for size in (1, 5, 13, 1000):
                batches = list(archive.iter_latest_batches(**query, batch_size=size))
                self.assertTrue(all(0 < len(batch) <= size for batch in batches))
                self.assertEqual(tuple(s for batch in batches for s in batch), expected)
            self.assertEqual(list(archive.iter_latest_batches(**{**query, "server_id": 2})), [])

    def test_concurrent_correction_does_not_change_running_read_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = JoinedSampleArchive(Path(directory) / "samples.sqlite")
            archive.record_batch([_sample(NOW + timedelta(seconds=i)) for i in range(3)],
                                 recorded_at_utc=NOW)
            query = dict(server_id=1, start_time_utc=NOW,
                         end_time_utc=NOW + timedelta(seconds=2))
            with closing(archive.iter_latest_batches(**query, batch_size=1)) as stream:
                next(stream)
                archive.record_batch([_sample(NOW + timedelta(seconds=2), latitude=33)],
                                     recorded_at_utc=NOW + timedelta(seconds=10))
                self.assertEqual(list(stream)[-1][0].latitude_deg, 32)
            self.assertEqual(archive.read_latest_window(**query)[-1].latitude_deg, 33)

    def test_stream_validation_and_early_close(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = JoinedSampleArchive(Path(directory) / "samples.sqlite")
            archive.record_batch([_sample(), _sample(vehicle_id=12)], recorded_at_utc=NOW)
            query = dict(server_id=1, start_time_utc=NOW, end_time_utc=NOW)
            for size in (0, -1, 10001, True, 1.5):
                with self.subTest(size=size), self.assertRaises(ValueError):
                    list(archive.iter_latest_batches(**query, batch_size=size))
            with self.assertRaises(ValueError):
                list(archive.iter_latest_batches(**{**query, "start_time_utc": NOW + timedelta(seconds=1)}))
            with self.assertRaises(ValueError):
                list(archive.iter_latest_batches(**{**query, "start_time_utc": NOW.replace(tzinfo=None)}))
            with closing(archive.iter_latest_batches(**query, batch_size=1)) as stream:
                self.assertEqual(len(next(stream)), 1)
            # Early cancellation releases the read snapshot so WAL can truncate.
            with closing(sqlite3.connect(archive.path)) as connection:
                self.assertEqual(connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0], 0)

    def test_insert_identical_reobservation_and_revision_are_distinct(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = JoinedSampleArchive(Path(directory) / "samples.sqlite")

            first = archive.record_batch([_sample()], recorded_at_utc=NOW)
            same = archive.record_batch([_sample()], recorded_at_utc=NOW + timedelta(seconds=5))
            corrected = archive.record_batch(
                [_sample(latitude=32.001)],
                recorded_at_utc=NOW + timedelta(seconds=10),
            )

            self.assertEqual((first.inserted, first.revised, first.unchanged), (1, 0, 0))
            self.assertEqual((same.inserted, same.revised, same.unchanged), (0, 0, 1))
            self.assertEqual((corrected.inserted, corrected.revised, corrected.unchanged), (0, 1, 0))
            self.assertTrue(corrected.has_correction)
            self.assertEqual(corrected.earliest_revised_sample_utc, NOW)

            revisions = archive.revision_history(
                server_id=1,
                vehicle_identifier=11,
                sample_time_utc=NOW,
            )
            self.assertEqual([row.revision for row in revisions], [1, 2])
            self.assertEqual(revisions[0].sample.latitude_deg, 32.0)
            self.assertEqual(revisions[1].sample.latitude_deg, 32.001)
            self.assertEqual(
                revisions[1].sample.field_quality["longitude_deg"],
                FieldQuality.INTERPOLATED,
            )

    def test_latest_window_returns_only_newest_revision_in_deterministic_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = JoinedSampleArchive(Path(directory) / "samples.sqlite")
            samples = [
                _sample(NOW + timedelta(seconds=2), vehicle_id=12, latitude=32.2),
                _sample(NOW, vehicle_id=11, latitude=32.0),
                _sample(NOW + timedelta(seconds=1), vehicle_id=11, latitude=32.1),
            ]
            archive.record_batch(samples, recorded_at_utc=NOW + timedelta(seconds=3))
            archive.record_batch(
                [_sample(NOW + timedelta(seconds=1), vehicle_id=11, latitude=32.101)],
                recorded_at_utc=NOW + timedelta(seconds=4),
            )

            rows = archive.read_latest_window(
                server_id=1,
                start_time_utc=NOW,
                end_time_utc=NOW + timedelta(seconds=2),
            )
            self.assertEqual(
                [(row.sample_time_utc, row.vehicle_identifier) for row in rows],
                [
                    (NOW, 11),
                    (NOW + timedelta(seconds=1), 11),
                    (NOW + timedelta(seconds=2), 12),
                ],
            )
            self.assertEqual(rows[1].latitude_deg, 32.101)

    def test_batch_reports_earliest_revised_timestamp(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = JoinedSampleArchive(Path(directory) / "samples.sqlite")
            initial = [
                _sample(NOW, vehicle_id=11),
                _sample(NOW + timedelta(seconds=5), vehicle_id=12),
            ]
            archive.record_batch(initial, recorded_at_utc=NOW + timedelta(seconds=6))
            result = archive.record_batch(
                [
                    _sample(NOW + timedelta(seconds=5), vehicle_id=12, latitude=32.5),
                    _sample(NOW, vehicle_id=11, latitude=32.4),
                ],
                recorded_at_utc=NOW + timedelta(seconds=10),
            )
            self.assertEqual(result.revised, 2)
            self.assertEqual(result.earliest_revised_sample_utc, NOW)

    def test_archive_schema_version_is_checked_on_reopen(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "samples.sqlite"
            JoinedSampleArchive(path)
            with sqlite3.connect(path) as connection:
                connection.execute(
                    "UPDATE archive_metadata SET value = '99' WHERE key = 'schema_version'"
                )
            with self.assertRaisesRegex(ValueError, "unsupported joined sample archive schema"):
                JoinedSampleArchive(path)


if __name__ == "__main__":
    unittest.main()
