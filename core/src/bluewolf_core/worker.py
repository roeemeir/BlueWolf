"""Language-neutral JSONL transport for the canonical Python Core.

The worker owns only in-memory CoreSession instances and pure analysis calls. It
does not access InfluxDB, files, databases or UI state. An external orchestrator
is responsible for source queries, Join, checkpoint persistence and lifecycle
supervision.

Protocol: one JSON object per stdin line, one JSON response per stdout line.
Supported commands: hello, create_session, process_batch, checkpoint,
restore_session, close_session, analyze_dataset, analyze_history.
"""

from __future__ import annotations

import base64
import dataclasses
import json
import sys
import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Mapping

from . import CORE_API_VERSION, IMPLEMENTATION_LANGUAGE, __version__
from .application_analysis import analyze_navigation_dataset, build_analysis_history, derive_events
from .config import CoreConfig
from .models import FieldQuality, VehicleSample
from .session_v17 import CoreSession


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _wire(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return {field.name: _wire(getattr(value, field.name)) for field in dataclasses.fields(value)}
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {str(key): _wire(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_wire(item) for item in value]
    return value


def _sample(raw: Mapping[str, Any]) -> VehicleSample:
    timestamp = raw.get("sample_time_utc", raw.get("timestamp"))
    if not isinstance(timestamp, str):
        raise ValueError("sample_time_utc/timestamp is required")

    server = raw.get("server_id", raw.get("serverId", 0))
    vehicle_identifier = raw.get("vehicle_identifier", raw.get("vehicleId"))
    if vehicle_identifier is None:
        raise ValueError("vehicle_identifier/vehicleId is required")
    vehicle_number = raw.get("vehicle_number", raw.get("vehicleNumber", vehicle_identifier))

    latitude = raw.get("latitude_deg", raw.get("latitude"))
    longitude = raw.get("longitude_deg", raw.get("longitude"))
    altitude = raw.get("altitude_m", raw.get("altitude"))
    velocity_north = raw.get("velocity_north_mps", raw.get("velocityNorth"))
    velocity_east = raw.get("velocity_east_mps", raw.get("velocityEast"))

    quality_raw = raw.get("field_quality", raw.get("fieldQuality", {}))
    field_quality = {
        str(key): item if isinstance(item, FieldQuality) else FieldQuality(str(item))
        for key, item in dict(quality_raw).items()
    }

    return VehicleSample(
        sample_time_utc=_parse_time(timestamp),
        server_id=int(server),
        vehicle_number=int(vehicle_number),
        vehicle_identifier=int(vehicle_identifier),
        active=raw.get("active"),
        latitude_deg=float(latitude) if latitude is not None else None,
        longitude_deg=float(longitude) if longitude is not None else None,
        altitude_m=float(altitude) if altitude is not None else None,
        velocity_north_mps=float(velocity_north) if velocity_north is not None else None,
        velocity_east_mps=float(velocity_east) if velocity_east is not None else None,
        reliability=float(raw.get("reliability", 1.0)),
        field_quality=field_quality,
    )


def _samples(raw: object) -> list[VehicleSample]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("samples must be a list")
    return [_sample(item) for item in raw]


def _config(raw: object) -> CoreConfig:
    return CoreConfig.from_dict(raw) if isinstance(raw, Mapping) else CoreConfig()


class CoreWorker:
    def __init__(self) -> None:
        self._sessions: dict[str, CoreSession] = {}

    def handle(self, request: Mapping[str, Any]) -> dict[str, Any]:
        command = str(request.get("command", ""))
        if command == "hello":
            return {
                "coreApiVersion": CORE_API_VERSION,
                "implementationLanguage": IMPLEMENTATION_LANGUAGE,
                "implementationVersion": __version__,
            }

        if command == "analyze_dataset":
            dataset = request.get("dataset")
            config = request.get("config")
            if not isinstance(dataset, Mapping):
                raise ValueError("dataset is required")
            if not isinstance(config, Mapping):
                raise ValueError("config is required")
            return {"analysis": analyze_navigation_dataset(dataset, config)}

        if command == "analyze_history":
            dataset = request.get("dataset")
            config = request.get("config")
            if not isinstance(dataset, Mapping):
                raise ValueError("dataset is required")
            if not isinstance(config, Mapping):
                raise ValueError("config is required")
            max_frames = int(request.get("maxFrames", 61))
            lookback_minutes = int(request.get("lookbackMinutes", 12))
            history = build_analysis_history(dataset, config, max_frames=max_frames, lookback_minutes=lookback_minutes)
            return {
                "history": history,
                "events": derive_events(history, config.get("thresholds", {})),
            }

        if command == "create_session":
            config = _config(request.get("config"))
            algorithm_version = str(request.get("algorithmVersion", __version__))
            session_id = uuid.uuid4().hex
            self._sessions[session_id] = CoreSession(config=config, algorithm_version=algorithm_version)
            return {"sessionId": session_id}

        if command == "process_batch":
            session = self._require_session(request)
            observed_raw = request.get("observedUntilUtc")
            observed = _parse_time(observed_raw) if isinstance(observed_raw, str) else None
            result = session.process_batch(_samples(request.get("samples")), observed_until_utc=observed)
            return {"result": _wire(result)}

        if command == "checkpoint":
            session = self._require_session(request)
            encoded = base64.b64encode(session.export_checkpoint()).decode("ascii")
            return {
                "checkpointBase64": encoded,
                "processedUntilUtc": _wire(session.processed_until_utc),
                "recoveryHistoryStartUtc": _wire(session.recovery_history_start_utc),
            }

        if command == "restore_session":
            encoded = request.get("checkpointBase64")
            if not isinstance(encoded, str):
                raise ValueError("checkpointBase64 is required")
            config = _config(request.get("config"))
            algorithm_version = str(request.get("algorithmVersion", __version__))
            checkpoint = base64.b64decode(encoded.encode("ascii"), validate=True)
            session_id = uuid.uuid4().hex
            session = CoreSession.from_checkpoint(
                checkpoint,
                config=config,
                algorithm_version=algorithm_version,
                recovery_samples=_samples(request.get("recoverySamples")),
            )
            self._sessions[session_id] = session
            return {
                "sessionId": session_id,
                "processedUntilUtc": _wire(session.processed_until_utc),
                "recoveryHistoryStartUtc": _wire(session.recovery_history_start_utc),
            }

        if command == "close_session":
            session_id = str(request.get("sessionId", ""))
            existed = self._sessions.pop(session_id, None) is not None
            return {"closed": existed}

        raise ValueError(f"unknown command: {command}")

    def _require_session(self, request: Mapping[str, Any]) -> CoreSession:
        session_id = str(request.get("sessionId", ""))
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError("unknown sessionId")
        return session


def main() -> None:
    worker = CoreWorker()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, Mapping):
                raise ValueError("request must be a JSON object")
            request_id = request.get("id")
            payload = worker.handle(request)
            response = {"ok": True, "id": request_id, **payload}
        except Exception as exc:  # transport boundary: return structured failure
            response = {
                "ok": False,
                "id": request_id,
                "error": type(exc).__name__,
                "message": str(exc),
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
