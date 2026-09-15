"""Immutable SQLite archive for investigation event lifecycle evidence.

This archive is reporting-only. It stores event/alert/recommendation transitions
emitted by ``LiveSOEventRuntime`` and never participates in route detection,
grouping, scoring or template selection.
"""
from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Mapping

from bluewolf_core.models import ChangeKind, StateChange


LIFECYCLE_SCHEMA_VERSION = 1
_RELEVANT_KINDS = {
    ChangeKind.EVENT_OPENED,
    ChangeKind.EVENT_ENDING,
    ChangeKind.EVENT_CLOSED,
    ChangeKind.ALERT_OPENED,
    ChangeKind.ALERT_CLOSED,
    ChangeKind.TEMPLATE_SUGGESTED,
    ChangeKind.TEMPLATE_SUGGESTION_CLOSED,
    ChangeKind.TEMPLATE_SUGGESTION_REJECTED,
}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("lifecycle time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _json(value: Mapping[str, Any]) -> str:
    return json.dumps(dict(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class SOEventLifecycleArchive:
    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path).expanduser().resolve(strict=False)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS so_event_lifecycle_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            row = connection.execute(
                "SELECT value FROM so_event_lifecycle_metadata WHERE key='schema_version'"
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO so_event_lifecycle_metadata(key,value) VALUES('schema_version',?)",
                    (str(LIFECYCLE_SCHEMA_VERSION),),
                )
            elif int(row["value"]) != LIFECYCLE_SCHEMA_VERSION:
                raise ValueError("unsupported SO event lifecycle schema")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS so_event_lifecycle_changes (
                    event_id TEXT NOT NULL,
                    change_time_utc TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY(event_id, change_time_utc, kind, payload_hash)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS so_event_lifecycle_event_idx
                ON so_event_lifecycle_changes(event_id, change_time_utc, kind)
                """
            )

    def record_change(self, change: StateChange) -> bool:
        if change.event_id is None or change.kind not in _RELEVANT_KINDS:
            return False
        if change.group_id is None:
            raise ValueError("event lifecycle change requires group_id")
        payload = _json(
            {
                "server_id": change.server_id,
                "group_id": change.group_id,
                "vehicle_identifier": change.vehicle_identifier,
                "details": dict(change.details),
            }
        )
        payload_hash = _hash(payload)
        timestamp = _iso(change.change_time_utc)
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO so_event_lifecycle_changes(
                    event_id,change_time_utc,kind,payload_hash,payload_json
                ) VALUES(?,?,?,?,?)
                """,
                (change.event_id, timestamp, change.kind.value, payload_hash, payload),
            )
            return cursor.rowcount > 0

    def event_lifecycle(self, event_id: str) -> dict[str, Any]:
        if not event_id:
            raise ValueError("event_id is required")
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT change_time_utc,kind,payload_json
                FROM so_event_lifecycle_changes
                WHERE event_id=?
                ORDER BY change_time_utc ASC, kind ASC
                """,
                (event_id,),
            ).fetchall()
        changes: list[dict[str, Any]] = []
        for row in rows:
            payload = json.loads(str(row["payload_json"]))
            if not isinstance(payload, dict):
                raise ValueError("archived lifecycle payload is malformed")
            details = payload.get("details", {})
            if not isinstance(details, dict):
                raise ValueError("archived lifecycle details are malformed")
            changes.append(
                {
                    "occurredAt": str(row["change_time_utc"]),
                    "kind": str(row["kind"]),
                    "serverId": int(payload["server_id"]),
                    "groupId": str(payload["group_id"]),
                    "details": details,
                }
            )

        opened = next((item for item in changes if item["kind"] == ChangeKind.EVENT_OPENED.value), None)
        ending = next((item for item in reversed(changes) if item["kind"] == ChangeKind.EVENT_ENDING.value), None)
        closed = next((item for item in reversed(changes) if item["kind"] == ChangeKind.EVENT_CLOSED.value), None)
        if closed is not None:
            status = "closed"
        elif ending is not None:
            status = "finalizing"
        else:
            status = "active"
        return {
            "status": status,
            "openedAt": None if opened is None else opened["occurredAt"],
            "openingReason": None if opened is None else opened["details"].get("reason"),
            "endedAt": None if ending is None else ending["occurredAt"],
            "endingReason": None if ending is None else ending["details"].get("reason"),
            "finalizeAt": None if ending is None else ending["details"].get("finalize_at_utc"),
            "closedAt": None if closed is None else closed["occurredAt"],
            "changes": changes,
        }


__all__ = ["LIFECYCLE_SCHEMA_VERSION", "SOEventLifecycleArchive"]
