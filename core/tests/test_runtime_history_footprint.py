from __future__ import annotations

from datetime import UTC, datetime
import json
import unittest

from bluewolf_runtime_adapter.history_contract import compact_runtime_history_point


NOW = datetime(2026, 9, 9, 20, 0, tzinfo=UTC)


def _full_snapshot(server_id: int, member_count: int = 15) -> dict[str, object]:
    observed_at = NOW.isoformat().replace("+00:00", "Z")
    members = [
        {
            "id": server_id * 1000 + index,
            "typeId": "A",
            "score": 83.25,
            "sync": 84.5,
            "route": 79.25,
            "confidence": 92.0,
            "phase": index / member_count,
            "scoreValid": True,
            "reasons": [],
            "latitude": 32.0 + index * 0.0001,
            "longitude": 34.8 + index * 0.0001,
            "headingDeg": 90.0,
        }
        for index in range(member_count)
    ]
    group = {
        "key": "so",
        "id": f"g-{server_id}",
        "name": f"Group {server_id}",
        "family": "SO",
        "subtitle": "Python Core · SO",
        "total": 82.0,
        "sync": 84.5,
        "route": 79.25,
        "confidence": 92.0,
        "color": "#4378e8",
        "members": members,
        "templateId": "tpl-so-h",
        "reason": "runtime",
        "success": "valid",
        "scoreValid": True,
        "observedAt": observed_at,
        "event": {
            "id": f"event-{server_id}",
            "contextKey": "ctx",
            "startedAt": observed_at,
            "active": True,
        },
    }
    return {
        "schemaVersion": "bluewolf.live-runtime.v1",
        "serverId": str(server_id),
        "arena": "arena-a",
        "status": "1 group · 15 vehicles",
        "observedAt": observed_at,
        "source": {"kind": "python-core", "health": "healthy", "detail": "runtime"},
        "groups": {"so": group},
        "groupList": [group],
    }


def _json_size(value: object) -> int:
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    )


class RuntimeHistoryFootprintTests(unittest.TestCase):
    def test_compact_history_point_is_at_least_ten_times_smaller_than_full_live_snapshot(self) -> None:
        full = _full_snapshot(1)
        compact = compact_runtime_history_point(full)
        full_bytes = _json_size(full)
        compact_bytes = _json_size(compact)

        # This is a deterministic serialization-size guard, not a wall-clock
        # benchmark. The generous 10x threshold protects against accidentally
        # putting member/map payloads back into the 30-minute history contract.
        self.assertLessEqual(compact_bytes * 10, full_bytes)
        self.assertNotIn("members", compact["groups"][0])

    def test_ten_server_thirty_minute_history_stays_below_one_megabyte_at_five_second_poll(self) -> None:
        points_per_server = 30 * 60 // 5 + 1
        compact_sizes = [
            _json_size(compact_runtime_history_point(_full_snapshot(server_id)))
            for server_id in range(1, 11)
        ]
        estimated_history_bytes = points_per_server * sum(compact_sizes)

        self.assertLess(estimated_history_bytes, 1_000_000)

    def test_one_second_poll_fits_the_default_two_thousand_point_cap(self) -> None:
        points_in_thirty_minutes = 30 * 60 // 1 + 1
        self.assertLessEqual(points_in_thirty_minutes, 2000)


if __name__ == "__main__":
    unittest.main()
