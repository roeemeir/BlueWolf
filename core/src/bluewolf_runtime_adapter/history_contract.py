"""Compact operator-history contract derived from validated live runtime snapshots.

The live snapshot contract carries map positions, per-member scores and other
operator details needed for the current frame. The 30-minute score timeline does
not need to persist that full payload at every poll. This module defines a
separate versioned contract containing only group-level score/event points.
"""
from __future__ import annotations

from copy import deepcopy
import math
from typing import Any, Mapping, Sequence

from .contract import LIVE_RUNTIME_SCHEMA_VERSION

LIVE_RUNTIME_HISTORY_SCHEMA_VERSION = "bluewolf.live-runtime-history.v1"


def _score(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
        raise ValueError(f"{name} must be finite and in [0,100]")
    return numeric


def _text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _groups_from_runtime_snapshot(snapshot: Mapping[str, Any]) -> Sequence[object]:
    group_list = snapshot.get("groupList")
    if group_list is not None:
        if not isinstance(group_list, list):
            raise ValueError("runtime groupList must be a list when supplied")
        return group_list
    groups = snapshot.get("groups")
    if not isinstance(groups, Mapping):
        raise ValueError("runtime groups must be an object")
    return list(groups.values())


def _compact_event(value: object) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("runtime history event must be an object")
    event_id = _text(value.get("id"), "runtime history event id")
    active = value.get("active", True)
    if not isinstance(active, bool):
        raise ValueError("runtime history event active must be boolean")
    return {"id": event_id, "active": active}


def _compact_group(value: object) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("runtime history group must be an object")
    score_valid = value.get("scoreValid", False)
    if not isinstance(score_valid, bool):
        raise ValueError("runtime history group scoreValid must be boolean")
    output: dict[str, Any] = {
        "id": _text(value.get("id"), "runtime history group id"),
        "name": _text(value.get("name"), "runtime history group name"),
        "color": _text(value.get("color"), "runtime history group color"),
        "total": _score(value.get("total"), "runtime history group total"),
        "sync": _score(value.get("sync"), "runtime history group sync"),
        "route": _score(value.get("route"), "runtime history group route"),
        "scoreValid": score_valid,
    }
    event = _compact_event(value.get("event"))
    if event is not None:
        output["event"] = event
    return output


def compact_runtime_history_point(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Project one full ``bluewolf.live-runtime.v1`` snapshot to one history point."""

    if snapshot.get("schemaVersion") != LIVE_RUNTIME_SCHEMA_VERSION:
        raise ValueError("unsupported live runtime schema for history projection")
    server_id = _text(snapshot.get("serverId"), "runtime history serverId")
    observed_at = _text(snapshot.get("observedAt"), "runtime history observedAt")
    groups = [_compact_group(group) for group in _groups_from_runtime_snapshot(snapshot)]
    return {
        "schemaVersion": LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
        "serverId": server_id,
        "observedAt": observed_at,
        "groups": groups,
    }


def normalize_runtime_history_point(
    value: Mapping[str, Any],
    *,
    expected_server_id: str | None = None,
) -> dict[str, Any]:
    """Validate a persisted/API history point and return a detached copy."""

    if value.get("schemaVersion") != LIVE_RUNTIME_HISTORY_SCHEMA_VERSION:
        raise ValueError("unsupported live runtime history schema")
    server_id = _text(value.get("serverId"), "runtime history serverId")
    if expected_server_id is not None and server_id != expected_server_id:
        raise ValueError("runtime history point belongs to a different server")
    observed_at = _text(value.get("observedAt"), "runtime history observedAt")
    raw_groups = value.get("groups")
    if not isinstance(raw_groups, list):
        raise ValueError("runtime history groups must be a list")
    groups = [_compact_group(group) for group in raw_groups]
    return deepcopy(
        {
            "schemaVersion": LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
            "serverId": server_id,
            "observedAt": observed_at,
            "groups": groups,
        }
    )


__all__ = [
    "LIVE_RUNTIME_HISTORY_SCHEMA_VERSION",
    "compact_runtime_history_point",
    "normalize_runtime_history_point",
]
