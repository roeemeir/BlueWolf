"""Durable SQLite archive for SO event scoring evidence and recomputations.

The archive stores immutable Core evidence frames, including timestamps where
scoring evidence was not yet sufficient. Investigation recomputation therefore
reuses Core observations and preserves the complete observed event range rather
than reconstructing phases or silently dropping missing points.

Navigation samples captured from the same live inputs are stored inside each
immutable frame payload. Older rows without navigation remain readable as an
empty navigation tuple; no position is reconstructed from phase or geometry.
Detected-route snapshots captured from the same live Core inputs are stored in
the same payload. Older rows without route geometry remain readable with empty
route evidence; reporting must not invent a route for them. The original active
Core template id is stored in the same immutable payload so reports can
reproduce the event without selecting an arbitrary template.

A frame is immutable by ``(event_id, sample_time_utc)``. Re-recording the exact
same frame is idempotent; conflicting evidence at the same key is rejected.
Recomputation results are stored separately with code/config/template provenance.
"""
from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Mapping

from bluewolf_core.event_recompute import SOEventNavigationPoint, SOEventObservationFrame
from bluewolf_core.event_route_evidence import SOEventRouteEvidence, SOEventRoutePoint
from bluewolf_core.so_scoring import SOScoringObservation


EVENT_ARCHIVE_SCHEMA_VERSION = 1


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("event archive time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _observation_payload(item: SOScoringObservation) -> dict[str, Any]:
    return {
        "member_id": item.member_id,
        "vehicle_type": item.vehicle_type,
        "route_instance_id": item.route_instance_id,
        "semantic_phase": item.semantic_phase,
        "period_error_ratio": item.period_error_ratio,
        "movement_error_ratio": item.movement_error_ratio,
        "distance_error_b_ratio": item.distance_error_b_ratio,
        "tangent_error_deg": item.tangent_error_deg,
        "curvature_error_ratio": item.curvature_error_ratio,
        "reliability": item.reliability,
        "speed_fraction": item.speed_fraction,
        "active": item.active,
        "position_reason": item.position_reason,
        "diagnostics": dict(item.diagnostics),
    }


def _observation_from_payload(value: Mapping[str, Any]) -> SOScoringObservation:
    diagnostics = value.get("diagnostics", {})
    if not isinstance(diagnostics, Mapping):
        raise ValueError("archived observation diagnostics must be an object")
    return SOScoringObservation(
        member_id=str(value["member_id"]),
        vehicle_type=str(value["vehicle_type"]),
        route_instance_id=str(value["route_instance_id"]),
        semantic_phase=float(value["semantic_phase"]),
        period_error_ratio=float(value["period_error_ratio"]),
        movement_error_ratio=float(value["movement_error_ratio"]),
        distance_error_b_ratio=float(value["distance_error_b_ratio"]),
        tangent_error_deg=(None if value.get("tangent_error_deg") is None else float(value["tangent_error_deg"])),
        curvature_error_ratio=(None if value.get("curvature_error_ratio") is None else float(value["curvature_error_ratio"])),
        reliability=float(value["reliability"]),
        speed_fraction=float(value["speed_fraction"]),
        active=value.get("active"),
        position_reason=str(value.get("position_reason") or "so_template_phase"),
        diagnostics={str(key): item for key, item in diagnostics.items()},
    )


def _navigation_payload(item: SOEventNavigationPoint) -> dict[str, Any]:
    return {
        "member_id": item.member_id,
        "vehicle_identifier": item.vehicle_identifier,
        "latitude_deg": item.latitude_deg,
        "longitude_deg": item.longitude_deg,
        "altitude_m": item.altitude_m,
        "velocity_north_mps": item.velocity_north_mps,
        "velocity_east_mps": item.velocity_east_mps,
        "active": item.active,
        "reliability": item.reliability,
    }


def _navigation_from_payload(value: Mapping[str, Any]) -> SOEventNavigationPoint:
    latitude = value.get("latitude_deg")
    longitude = value.get("longitude_deg")
    altitude = value.get("altitude_m")
    north = value.get("velocity_north_mps")
    east = value.get("velocity_east_mps")
    active = value.get("active")
    if active is not None and not isinstance(active, bool):
        raise ValueError("archived navigation active must be boolean or null")
    return SOEventNavigationPoint(
        member_id=str(value["member_id"]),
        vehicle_identifier=int(value["vehicle_identifier"]),
        latitude_deg=None if latitude is None else float(latitude),
        longitude_deg=None if longitude is None else float(longitude),
        altitude_m=None if altitude is None else float(altitude),
        velocity_north_mps=None if north is None else float(north),
        velocity_east_mps=None if east is None else float(east),
        active=active,
        reliability=float(value.get("reliability", 1.0)),
    )


def _route_payload(item: SOEventRouteEvidence) -> dict[str, Any]:
    return {
        "route_instance_id": item.route_instance_id,
        "route_id": item.route_id,
        "family": item.family,
        "subtype": item.subtype,
        "topology": item.topology,
        "center_latitude_deg": item.center_latitude_deg,
        "center_longitude_deg": item.center_longitude_deg,
        "length_m": item.length_m,
        "long_axis_a_m": item.long_axis_a_m,
        "short_axis_b_m": item.short_axis_b_m,
        "orientation_deg": item.orientation_deg,
        "estimated_period_s": item.estimated_period_s,
        "direction": item.direction,
        "detection_quality": item.detection_quality,
        "centerline_wgs84": [
            {"latitude_deg": point.latitude_deg, "longitude_deg": point.longitude_deg}
            for point in item.centerline_wgs84
        ],
    }


def _route_from_payload(value: Mapping[str, Any]) -> SOEventRouteEvidence:
    centerline_raw = value.get("centerline_wgs84", [])
    if not isinstance(centerline_raw, list):
        raise ValueError("archived route centerline must be an array")
    centerline = tuple(
        SOEventRoutePoint(
            latitude_deg=float(point["latitude_deg"]),
            longitude_deg=float(point["longitude_deg"]),
        )
        for point in centerline_raw
        if isinstance(point, Mapping)
    )
    if len(centerline) != len(centerline_raw):
        raise ValueError("archived route centerline row is malformed")
    return SOEventRouteEvidence(
        route_instance_id=str(value["route_instance_id"]),
        route_id=str(value["route_id"]),
        family=str(value["family"]),
        subtype=str(value["subtype"]),
        topology=str(value["topology"]),
        center_latitude_deg=float(value["center_latitude_deg"]),
        center_longitude_deg=float(value["center_longitude_deg"]),
        length_m=float(value["length_m"]),
        long_axis_a_m=float(value["long_axis_a_m"]),
        short_axis_b_m=float(value["short_axis_b_m"]),
        orientation_deg=float(value["orientation_deg"]),
        estimated_period_s=float(value["estimated_period_s"]),
        direction=str(value["direction"]),
        detection_quality=float(value["detection_quality"]),
        centerline_wgs84=centerline,
    )


def _frame_payload(frame: SOEventObservationFrame) -> str:
    return json.dumps(
        {
            "server_id": frame.server_id,
            "group_id": frame.group_id,
            "active_template_id": frame.active_template_id,
            "pending_reason": frame.pending_reason,
            "observations": [_observation_payload(item) for item in frame.observations],
            "navigation": [_navigation_payload(item) for item in frame.navigation],
            "routes": [_route_payload(item) for item in frame.routes],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class SOEventObservationArchive:
    """SQLite-backed immutable event evidence and recomputation archive."""

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
                CREATE TABLE IF NOT EXISTS so_event_archive_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            row = connection.execute(
                "SELECT value FROM so_event_archive_metadata WHERE key='schema_version'"
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO so_event_archive_metadata(key,value) VALUES('schema_version',?)",
                    (str(EVENT_ARCHIVE_SCHEMA_VERSION),),
                )
            elif int(row["value"]) != EVENT_ARCHIVE_SCHEMA_VERSION:
                raise ValueError("unsupported SO event archive schema")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS so_event_observation_frames (
                    event_id TEXT NOT NULL,
                    server_id INTEGER NOT NULL,
                    group_id TEXT NOT NULL,
                    sample_time_utc TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY(event_id, sample_time_utc)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS so_event_frames_server_time_idx
                ON so_event_observation_frames(server_id, sample_time_utc, event_id)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS so_event_recomputations (
                    run_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    scenario_id TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    template_version TEXT NOT NULL,
                    code_version TEXT NOT NULL,
                    config_version TEXT NOT NULL,
                    created_at_utc TEXT NOT NULL,
                    result_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS so_event_recompute_event_idx
                ON so_event_recomputations(event_id, created_at_utc, run_id)
                """
            )

    def record_frame(self, frame: SOEventObservationFrame) -> bool:
        payload = _frame_payload(frame)
        payload_hash = _hash(payload)
        timestamp = _iso(frame.sample_time_utc)
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT payload_hash FROM so_event_observation_frames WHERE event_id=? AND sample_time_utc=?",
                (frame.event_id, timestamp),
            ).fetchone()
            if existing is not None:
                if str(existing["payload_hash"]) != payload_hash:
                    raise ValueError("conflicting immutable SO event evidence")
                return False
            connection.execute(
                """
                INSERT INTO so_event_observation_frames(
                    event_id,server_id,group_id,sample_time_utc,payload_hash,payload_json
                ) VALUES(?,?,?,?,?,?)
                """,
                (frame.event_id, frame.server_id, frame.group_id, timestamp, payload_hash, payload),
            )
        return True

    def read_event(self, event_id: str) -> tuple[SOEventObservationFrame, ...]:
        if not event_id:
            raise ValueError("event_id is required")
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT server_id,group_id,sample_time_utc,payload_json
                FROM so_event_observation_frames
                WHERE event_id=? ORDER BY sample_time_utc ASC
                """,
                (event_id,),
            ).fetchall()
        frames: list[SOEventObservationFrame] = []
        for row in rows:
            payload = json.loads(str(row["payload_json"]))
            observations_raw = payload.get("observations", [])
            if not isinstance(observations_raw, list):
                raise ValueError("archived SO event observations are malformed")
            observations = tuple(
                _observation_from_payload(item)
                for item in observations_raw
                if isinstance(item, Mapping)
            )
            if len(observations) != len(observations_raw):
                raise ValueError("archived SO event observation row is malformed")
            navigation_raw = payload.get("navigation", [])
            if not isinstance(navigation_raw, list):
                raise ValueError("archived SO event navigation is malformed")
            navigation = tuple(
                _navigation_from_payload(item)
                for item in navigation_raw
                if isinstance(item, Mapping)
            )
            if len(navigation) != len(navigation_raw):
                raise ValueError("archived SO event navigation row is malformed")
            routes_raw = payload.get("routes", [])
            if not isinstance(routes_raw, list):
                raise ValueError("archived SO event routes are malformed")
            routes = tuple(
                _route_from_payload(item)
                for item in routes_raw
                if isinstance(item, Mapping)
            )
            if len(routes) != len(routes_raw):
                raise ValueError("archived SO event route row is malformed")
            pending_raw = payload.get("pending_reason")
            pending_reason = None if pending_raw is None else str(pending_raw)
            active_template_raw = payload.get("active_template_id")
            active_template_id = None if active_template_raw is None else str(active_template_raw)
            frames.append(
                SOEventObservationFrame(
                    event_id=event_id,
                    server_id=int(row["server_id"]),
                    group_id=str(row["group_id"]),
                    sample_time_utc=_parse_time(str(row["sample_time_utc"])),
                    observations=observations,
                    active_template_id=active_template_id,
                    pending_reason=pending_reason,
                    navigation=navigation,
                    routes=routes,
                )
            )
        return tuple(frames)

    def list_events(
        self,
        server_id: int,
        *,
        from_utc: datetime | None = None,
        to_utc: datetime | None = None,
        limit: int = 200,
    ) -> tuple[dict[str, Any], ...]:
        """List complete events that intersect an optional UTC investigation range.

        The range filters event selection only. Returned start/end/frameCount are
        the event's full archived bounds so selecting a range never clips event
        identity or silently turns one event into a shorter synthetic event.
        ``activeTemplateId`` is returned only when all archived frames that know
        the original active template agree. Older events may return ``None`` and
        must not receive an invented report template.
        """

        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 2000:
            raise ValueError("limit must be an integer in [1,2000]")
        from_iso = None if from_utc is None else _iso(from_utc)
        to_iso = None if to_utc is None else _iso(to_utc)
        if from_utc is not None and to_utc is not None and _utc(from_utc) > _utc(to_utc):
            raise ValueError("investigation range start must not be after end")
        with self._connect() as connection:
            rows = connection.execute(
                """
                WITH event_bounds AS (
                    SELECT event_id,group_id,MIN(sample_time_utc) AS start_at,
                           MAX(sample_time_utc) AS end_at,COUNT(*) AS frame_count
                    FROM so_event_observation_frames
                    WHERE server_id=?
                    GROUP BY event_id,group_id
                )
                SELECT event_id,group_id,start_at,end_at,frame_count
                FROM event_bounds
                WHERE (? IS NULL OR end_at >= ?)
                  AND (? IS NULL OR start_at <= ?)
                ORDER BY start_at DESC LIMIT ?
                """,
                (server_id, from_iso, from_iso, to_iso, to_iso, limit),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            event_id = str(row["event_id"])
            frames = self.read_event(event_id)
            known_templates = {
                frame.active_template_id
                for frame in frames
                if frame.active_template_id is not None
            }
            if len(known_templates) > 1:
                raise ValueError("archived event contains multiple active templates")
            results.append(
                {
                    "eventId": event_id,
                    "serverId": server_id,
                    "groupId": str(row["group_id"]),
                    "startAt": str(row["start_at"]),
                    "endAt": str(row["end_at"]),
                    "frameCount": int(row["frame_count"]),
                    "activeTemplateId": (next(iter(known_templates)) if known_templates else None),
                }
            )
        return tuple(results)

    def record_recompute(self, result: Mapping[str, Any], *, created_at_utc: datetime) -> None:
        required = (
            "runId",
            "eventId",
            "scenarioId",
            "templateId",
            "templateVersion",
            "codeVersion",
            "configVersion",
        )
        values = {key: str(result.get(key) or "").strip() for key in required}
        missing = [key for key, value in values.items() if not value]
        if missing:
            raise ValueError(f"recompute result is missing provenance: {', '.join(missing)}")
        result_json = json.dumps(
            dict(result),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO so_event_recomputations(
                    run_id,event_id,scenario_id,template_id,template_version,
                    code_version,config_version,created_at_utc,result_json
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    values["runId"],
                    values["eventId"],
                    values["scenarioId"],
                    values["templateId"],
                    values["templateVersion"],
                    values["codeVersion"],
                    values["configVersion"],
                    _iso(created_at_utc),
                    result_json,
                ),
            )

    def recomputations(self, event_id: str) -> tuple[dict[str, Any], ...]:
        if not event_id:
            raise ValueError("event_id is required")
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT result_json FROM so_event_recomputations WHERE event_id=? ORDER BY created_at_utc ASC, run_id ASC",
                (event_id,),
            ).fetchall()
        return tuple(json.loads(str(row["result_json"])) for row in rows)


__all__ = ["EVENT_ARCHIVE_SCHEMA_VERSION", "SOEventObservationArchive"]
