from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.models import VehicleSample
from bluewolf_runtime_adapter.position_enrichment import enrich_runtime_snapshot_positions


START = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def _sample(
    when: datetime,
    *,
    latitude: float,
    longitude: float,
    east: float | None = None,
    north: float | None = None,
) -> VehicleSample:
    return VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=10,
        vehicle_identifier=101,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        altitude_m=None,
        velocity_north_mps=north,
        velocity_east_mps=east,
        reliability=1.0,
        field_quality={},
    )


def _snapshot(observed_at: datetime):
    group = {
        "key": "so",
        "id": "g1",
        "family": "SO",
        "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
        "members": [{"id": 101}],
    }
    return {
        "schemaVersion": "bluewolf.live-runtime.v1",
        "serverId": "1",
        "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
        "groups": {"so": group},
        "groupList": [group],
    }


class RuntimePositionEnrichmentTests(unittest.TestCase):
    def test_uses_exact_group_timestamp_and_navigation_heading(self) -> None:
        snapshot = _snapshot(START)
        enriched = enrich_runtime_snapshot_positions(
            snapshot,
            (
                _sample(START, latitude=12.0, longitude=34.0, east=1.0, north=0.0),
                _sample(
                    START + timedelta(seconds=5),
                    latitude=13.0,
                    longitude=35.0,
                    east=0.0,
                    north=1.0,
                ),
            ),
        )
        member = enriched["groupList"][0]["members"][0]
        self.assertEqual(member["latitude"], 12.0)
        self.assertEqual(member["longitude"], 34.0)
        self.assertAlmostEqual(member["headingDeg"], 90.0)
        legacy = enriched["groups"]["so"]["members"][0]
        self.assertEqual(legacy["latitude"], 12.0)

    def test_does_not_backfill_from_newer_or_older_sample(self) -> None:
        snapshot = _snapshot(START)
        enriched = enrich_runtime_snapshot_positions(
            snapshot,
            (
                _sample(START - timedelta(seconds=1), latitude=11.0, longitude=33.0),
                _sample(START + timedelta(seconds=1), latitude=13.0, longitude=35.0),
            ),
        )
        member = enriched["groupList"][0]["members"][0]
        self.assertNotIn("latitude", member)
        self.assertNotIn("longitude", member)
        self.assertNotIn("headingDeg", member)

    def test_zero_speed_omits_heading_but_keeps_position(self) -> None:
        snapshot = _snapshot(START)
        enriched = enrich_runtime_snapshot_positions(
            snapshot,
            (_sample(START, latitude=12.0, longitude=34.0, east=0.0, north=0.0),),
        )
        member = enriched["groupList"][0]["members"][0]
        self.assertEqual(member["latitude"], 12.0)
        self.assertEqual(member["longitude"], 34.0)
        self.assertNotIn("headingDeg", member)


if __name__ == "__main__":
    unittest.main()
