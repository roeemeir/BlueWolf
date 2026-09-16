from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from bluewolf_core.models import VehicleSample
from bluewolf_runtime_adapter.sample_archive import JoinedSampleArchive


START = datetime(2026, 9, 16, 6, 0, tzinfo=UTC)
ACTIVE_POLL_SECONDS = 5
WORKDAY_HOURS = 8
TICKS = WORKDAY_HOURS * 3600 // ACTIVE_POLL_SECONDS + 1
VEHICLES = (101, 102)


def _sample(when: datetime, vehicle_id: int, *, latitude_offset: float = 0.0) -> VehicleSample:
    return VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=vehicle_id,
        vehicle_identifier=vehicle_id,
        active=True,
        latitude_deg=32.0 + latitude_offset,
        longitude_deg=34.8 + (vehicle_id - 100) * 0.00001,
        altitude_m=10.0,
        velocity_north_mps=10.0,
        velocity_east_mps=5.0,
        reliability=1.0,
        field_quality={},
    )


class OfflineWorkdaySoakTests(unittest.TestCase):
    def test_eight_hour_active_poll_archive_survives_restart_and_retention_bounds_old_revisions(self) -> None:
        with TemporaryDirectory(prefix="bluewolf-workday-") as directory:
            path = Path(directory) / "joined-samples.sqlite3"
            archive = JoinedSampleArchive(path, retention_days=1, prune_interval_seconds=3600)

            old_time = START - timedelta(days=2)
            archive.record_batch((_sample(old_time, 101),), recorded_at_utc=old_time)
            archive.record_batch(
                (_sample(old_time, 101, latitude_offset=0.01),),
                recorded_at_utc=old_time + timedelta(seconds=5),
            )
            self.assertEqual(len(archive.revision_history(server_id=1, vehicle_identifier=101, sample_time_utc=old_time)), 2)

            samples = tuple(
                _sample(START + timedelta(seconds=tick * ACTIVE_POLL_SECONDS), vehicle_id)
                for tick in range(TICKS)
                for vehicle_id in VEHICLES
            )
            end = START + timedelta(hours=WORKDAY_HOURS)
            result = archive.record_batch(samples, recorded_at_utc=end)
            self.assertEqual(result.inserted, TICKS * len(VEHICLES))
            self.assertEqual(result.revised, 0)
            self.assertEqual(result.unchanged, 0)

            with sqlite3.connect(path) as connection:
                latest_count = connection.execute("SELECT COUNT(*) FROM joined_sample_latest").fetchone()[0]
                revision_count = connection.execute("SELECT COUNT(*) FROM joined_sample_revisions").fetchone()[0]
                old_latest = connection.execute(
                    "SELECT COUNT(*) FROM joined_sample_latest WHERE sample_time_utc < ?",
                    ((START - timedelta(days=1)).isoformat().replace("+00:00", "Z"),),
                ).fetchone()[0]
                old_revisions = connection.execute(
                    "SELECT COUNT(*) FROM joined_sample_revisions WHERE sample_time_utc < ?",
                    ((START - timedelta(days=1)).isoformat().replace("+00:00", "Z"),),
                ).fetchone()[0]
            self.assertEqual(latest_count, TICKS * len(VEHICLES))
            self.assertEqual(revision_count, TICKS * len(VEHICLES))
            self.assertEqual(old_latest, 0)
            self.assertEqual(old_revisions, 0)

            # Process-style restart: build a fresh archive object against the same file.
            reopened = JoinedSampleArchive(path, retention_days=1, prune_interval_seconds=3600)
            replayed = reopened.read_latest_window(server_id=1, start_time_utc=START, end_time_utc=end)
            self.assertEqual(len(replayed), TICKS * len(VEHICLES))
            self.assertEqual(replayed[0].sample_time_utc, START)
            self.assertEqual(replayed[-1].sample_time_utc, end)
            self.assertEqual({sample.vehicle_identifier for sample in replayed}, set(VEHICLES))

            # A workday at the active poll cadence must remain a bounded local artifact,
            # not an accidental memory-only test. Keep the threshold intentionally loose
            # so it catches runaway duplication rather than SQLite page-size variation.
            self.assertLess(path.stat().st_size, 32 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
