"""Versioned local archive for canonical joined navigation samples.

Late data cannot be injected into a ``CoreSession`` that already advanced past
that timestamp; the core intentionally ignores historical overlap and expects a
fresh-session replay from an earlier checkpoint. This archive is the durable
input side of that future replay path.

The archive stores every changed revision of one canonical joined sample while
keeping a compact latest table for window reads. Identical re-observations are
no-ops. SQLite is used from the Python standard library so the same file works
for Windows and the single-writer OpenShift runtime without a new dependency.
"""
from __future__ import annotations

from dataclasses import dataclass
from contextlib import closing
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Iterable, Iterator, Mapping

from bluewolf_core.models import FieldQuality, VehicleSample


ARCHIVE_SCHEMA_VERSION = 1


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("archive time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _quality_value(value: object) -> str:
    if isinstance(value, FieldQuality):
        return value.value
    return str(value)


def _payload(sample: VehicleSample) -> dict[str, object]:
    return {
        "vehicle_number": sample.vehicle_number,
        "active": sample.active,
        "latitude_deg": sample.latitude_deg,
        "longitude_deg": sample.longitude_deg,
        "altitude_m": sample.altitude_m,
        "velocity_north_mps": sample.velocity_north_mps,
        "velocity_east_mps": sample.velocity_east_mps,
        "reliability": sample.reliability,
        "field_quality": {
            str(key): _quality_value(value)
            for key, value in sorted(sample.field_quality.items(), key=lambda item: str(item[0]))
        },
    }


def _payload_json(sample: VehicleSample) -> str:
    return json.dumps(
        _payload(sample),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _payload_hash(payload_json: str) -> str:
    return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


def _sample_from_row(row: sqlite3.Row) -> VehicleSample:
    payload = json.loads(str(row["payload_json"]))
    quality_raw = payload.get("field_quality", {})
    if not isinstance(quality_raw, Mapping):
        raise ValueError("archived field_quality is invalid")
    return VehicleSample(
        sample_time_utc=_parse_time(str(row["sample_time_utc"])),
        server_id=int(row["server_id"]),
        vehicle_number=int(payload["vehicle_number"]),
        vehicle_identifier=int(row["vehicle_identifier"]),
        active=payload.get("active"),
        latitude_deg=payload.get("latitude_deg"),
        longitude_deg=payload.get("longitude_deg"),
        altitude_m=payload.get("altitude_m"),
        velocity_north_mps=payload.get("velocity_north_mps"),
        velocity_east_mps=payload.get("velocity_east_mps"),
        reliability=float(payload.get("reliability", 1.0)),
        field_quality={
            str(key): FieldQuality(str(value))
            for key, value in quality_raw.items()
        },
    )


@dataclass(frozen=True, slots=True)
class SampleArchiveWriteResult:
    inserted: int
    revised: int
    unchanged: int
    earliest_revised_sample_utc: datetime | None

    @property
    def has_correction(self) -> bool:
        return self.revised > 0


@dataclass(frozen=True, slots=True)
class ArchivedSampleRevision:
    server_id: int
    vehicle_identifier: int
    sample_time_utc: datetime
    revision: int
    recorded_at_utc: datetime
    sample: VehicleSample


class JoinedSampleArchive:
    """SQLite archive with deterministic revision semantics."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path).expanduser().resolve(strict=False)
        if not str(self.path):
            raise ValueError("sample archive path is required")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS archive_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            existing = connection.execute(
                "SELECT value FROM archive_metadata WHERE key = 'schema_version'"
            ).fetchone()
            if existing is None:
                connection.execute(
                    "INSERT INTO archive_metadata(key, value) VALUES('schema_version', ?)",
                    (str(ARCHIVE_SCHEMA_VERSION),),
                )
            elif int(existing["value"]) != ARCHIVE_SCHEMA_VERSION:
                raise ValueError("unsupported joined sample archive schema")

            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS joined_sample_latest (
                    server_id INTEGER NOT NULL,
                    vehicle_identifier INTEGER NOT NULL,
                    sample_time_utc TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    recorded_at_utc TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY(server_id, vehicle_identifier, sample_time_utc)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS joined_sample_revisions (
                    server_id INTEGER NOT NULL,
                    vehicle_identifier INTEGER NOT NULL,
                    sample_time_utc TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    recorded_at_utc TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY(server_id, vehicle_identifier, sample_time_utc, revision)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS joined_sample_latest_window_idx
                ON joined_sample_latest(server_id, sample_time_utc, vehicle_identifier)
                """
            )

    def record_batch(
        self,
        samples: Iterable[VehicleSample],
        *,
        recorded_at_utc: datetime,
    ) -> SampleArchiveWriteResult:
        recorded_at = _iso(recorded_at_utc)
        ordered = sorted(
            samples,
            key=lambda sample: (
                sample.server_id,
                sample.vehicle_identifier,
                sample.sample_time_utc,
                sample.vehicle_number,
            ),
        )
        inserted = 0
        revised = 0
        unchanged = 0
        earliest_revised: datetime | None = None

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for sample in ordered:
                sample_time = _iso(sample.sample_time_utc)
                payload_json = _payload_json(sample)
                payload_hash = _payload_hash(payload_json)
                current = connection.execute(
                    """
                    SELECT revision, payload_hash, payload_json
                    FROM joined_sample_latest
                    WHERE server_id = ? AND vehicle_identifier = ? AND sample_time_utc = ?
                    """,
                    (sample.server_id, sample.vehicle_identifier, sample_time),
                ).fetchone()

                if current is None:
                    revision = 1
                    inserted += 1
                elif (
                    str(current["payload_hash"]) == payload_hash
                    and str(current["payload_json"]) == payload_json
                ):
                    unchanged += 1
                    continue
                else:
                    revision = int(current["revision"]) + 1
                    revised += 1
                    timestamp = sample.sample_time_utc.astimezone(UTC)
                    if earliest_revised is None or timestamp < earliest_revised:
                        earliest_revised = timestamp

                connection.execute(
                    """
                    INSERT INTO joined_sample_revisions(
                        server_id, vehicle_identifier, sample_time_utc, revision,
                        recorded_at_utc, payload_hash, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        sample.server_id,
                        sample.vehicle_identifier,
                        sample_time,
                        revision,
                        recorded_at,
                        payload_hash,
                        payload_json,
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO joined_sample_latest(
                        server_id, vehicle_identifier, sample_time_utc, revision,
                        recorded_at_utc, payload_hash, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(server_id, vehicle_identifier, sample_time_utc)
                    DO UPDATE SET
                        revision = excluded.revision,
                        recorded_at_utc = excluded.recorded_at_utc,
                        payload_hash = excluded.payload_hash,
                        payload_json = excluded.payload_json
                    """,
                    (
                        sample.server_id,
                        sample.vehicle_identifier,
                        sample_time,
                        revision,
                        recorded_at,
                        payload_hash,
                        payload_json,
                    ),
                )

        return SampleArchiveWriteResult(
            inserted=inserted,
            revised=revised,
            unchanged=unchanged,
            earliest_revised_sample_utc=earliest_revised,
        )

    def read_latest_window(
        self,
        *,
        server_id: int,
        start_time_utc: datetime,
        end_time_utc: datetime,
    ) -> tuple[VehicleSample, ...]:
        """Compatibility helper for small windows; large replay uses batches."""
        return tuple(
            sample
            for batch in self.iter_latest_batches(
                server_id=server_id,
                start_time_utc=start_time_utc,
                end_time_utc=end_time_utc,
            )
            for sample in batch
        )

    def iter_latest_batches(
        self,
        *,
        server_id: int,
        start_time_utc: datetime,
        end_time_utc: datetime,
        batch_size: int = 1000,
    ) -> Iterator[tuple[VehicleSample, ...]]:
        """Stream one consistent SQLite snapshot with bounded Python memory.

        Bounds are inclusive, matching ``read_latest_window``. The read snapshot
        starts on first iteration. Corrections committed afterwards are visible
        only to a new iterator, never halfway through this replay. Consumers
        stopping early must close the generator (e.g. ``contextlib.closing``)
        to release its read transaction. A long-lived reader can retain WAL
        pages; this is not a durable revision selector for archived reports.
        """
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 10000:
            raise ValueError("archive batch_size must be an integer in 1..10000")
        start = _utc(start_time_utc)
        end = _utc(end_time_utc)
        if end < start:
            raise ValueError("archive window end cannot precede start")
        with closing(self._connect()) as connection:
            connection.execute("BEGIN")
            cursor = connection.execute(
                """
                SELECT server_id, vehicle_identifier, sample_time_utc, payload_json
                FROM joined_sample_latest
                WHERE server_id = ? AND sample_time_utc >= ? AND sample_time_utc <= ?
                ORDER BY sample_time_utc, vehicle_identifier
                """,
                (server_id, _iso(start), _iso(end)),
            )
            try:
                while rows := cursor.fetchmany(batch_size):
                    yield tuple(_sample_from_row(row) for row in rows)
            finally:
                cursor.close()
                connection.rollback()

    def revision_history(
        self,
        *,
        server_id: int,
        vehicle_identifier: int,
        sample_time_utc: datetime,
    ) -> tuple[ArchivedSampleRevision, ...]:
        timestamp = _iso(sample_time_utc)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT server_id, vehicle_identifier, sample_time_utc, revision,
                       recorded_at_utc, payload_json
                FROM joined_sample_revisions
                WHERE server_id = ? AND vehicle_identifier = ? AND sample_time_utc = ?
                ORDER BY revision
                """,
                (server_id, vehicle_identifier, timestamp),
            ).fetchall()
        return tuple(
            ArchivedSampleRevision(
                server_id=int(row["server_id"]),
                vehicle_identifier=int(row["vehicle_identifier"]),
                sample_time_utc=_parse_time(str(row["sample_time_utc"])),
                revision=int(row["revision"]),
                recorded_at_utc=_parse_time(str(row["recorded_at_utc"])),
                sample=_sample_from_row(row),
            )
            for row in rows
        )


__all__ = [
    "ARCHIVE_SCHEMA_VERSION",
    "ArchivedSampleRevision",
    "JoinedSampleArchive",
    "SampleArchiveWriteResult",
]
