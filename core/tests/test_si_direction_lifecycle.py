from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.config import GroupingConfig
from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import (
    CanonicalPoint,
    ChangeKind,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleSample,
)
from bluewolf_core.si_direction_evidence import live_si_direction
from bluewolf_core.si_direction_lifecycle import (
    SIDirectionLifecycle,
    SIDirectionObservation,
)


START = datetime(2026, 9, 8, 12, 0, tzinfo=UTC)
GROUP_ID = "g:1:000001"


def _obs(member: int, direction: Direction) -> SIDirectionObservation:
    return SIDirectionObservation(
        group_id=GROUP_ID,
        server_id=1,
        member_key=(1, member),
        direction=direction,
    )


def _pair(first: Direction, second: Direction):
    return (_obs(101, first), _obs(102, second))


def _clockwise_square_route() -> ClosedRoute:
    return ClosedRoute(
        route_id="cw-square",
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        canonical_points=(
            CanonicalPoint(10.0, 10.0),
            CanonicalPoint(10.0, -10.0),
            CanonicalPoint(-10.0, -10.0),
            CanonicalPoint(-10.0, 10.0),
        ),
        center_latitude_deg=32.0,
        center_longitude_deg=34.8,
        length_m=80.0,
        long_axis_a_m=10.0,
        short_axis_b_m=10.0,
        orientation_deg=0.0,
        estimated_period_s=80.0,
        direction=Direction.CLOCKWISE,
        detection_quality=1.0,
    )


def _direction_sample(north_mps: float) -> VehicleSample:
    latitude, longitude = local_m_to_wgs84(
        CanonicalPoint(10.0, 0.0),
        32.0,
        34.8,
    )
    return VehicleSample(
        sample_time_utc=START,
        server_id=1,
        vehicle_number=1,
        vehicle_identifier=101,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        velocity_east_mps=0.0,
        velocity_north_mps=north_mps,
        reliability=1.0,
    )


class SIDirectionLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = GroupingConfig(
            si_wrong_direction_alert_seconds=60,
            si_wrong_direction_exit_additional_seconds=300,
        )

    def test_live_direction_uses_canonical_tangent_without_clockwise_double_flip(self) -> None:
        route = _clockwise_square_route()
        self.assertIs(
            live_si_direction(_direction_sample(-2.0), route),
            Direction.CLOCKWISE,
        )
        self.assertIs(
            live_si_direction(_direction_sample(2.0), route),
            Direction.COUNTERCLOCKWISE,
        )

    def test_single_member_opposite_alerts_at_one_minute(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START,
            fallback_direction=Direction.COUNTERCLOCKWISE,
        )
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=30),
        )
        result = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=60),
        )

        self.assertEqual(result.removal_keys, ())
        self.assertEqual(len(result.changes), 1)
        self.assertIs(result.changes[0].kind, ChangeKind.ALERT_OPENED)
        self.assertEqual(result.changes[0].vehicle_identifier, 102)
        self.assertEqual(result.changes[0].details["reason"], "si_wrong_direction")
        self.assertEqual(result.wrong_direction_seconds[(1, 102)], 60.0)

    def test_member_is_removed_only_after_five_additional_minutes(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        for second in (0, 60, 359):
            result = engine.update_group(
                GROUP_ID,
                _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
                START + timedelta(seconds=second),
                fallback_direction=Direction.COUNTERCLOCKWISE,
            )
            self.assertEqual(result.removal_keys, ())

        result = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=360),
        )
        self.assertEqual(result.removal_keys, ((1, 102),))
        self.assertGreaterEqual(result.wrong_direction_seconds[(1, 102)], 360.0)

    def test_recovery_closes_alert_and_resets_accumulation(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START,
            fallback_direction=Direction.COUNTERCLOCKWISE,
        )
        opened = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=65),
        )
        self.assertTrue(any(item.kind is ChangeKind.ALERT_OPENED for item in opened.changes))

        recovered = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.COUNTERCLOCKWISE),
            START + timedelta(seconds=70),
        )
        self.assertTrue(any(item.kind is ChangeKind.ALERT_CLOSED for item in recovered.changes))
        self.assertNotIn((1, 102), recovered.wrong_direction_seconds)

    def test_unknown_direction_pauses_not_accumulates_mismatch(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START,
            fallback_direction=Direction.COUNTERCLOCKWISE,
        )
        first = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=30),
        )
        self.assertEqual(first.wrong_direction_seconds[(1, 102)], 30.0)

        paused = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.UNKNOWN),
            START + timedelta(seconds=120),
        )
        self.assertEqual(paused.wrong_direction_seconds[(1, 102)], 30.0)
        self.assertFalse(any(item.kind is ChangeKind.ALERT_OPENED for item in paused.changes))

        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=150),
        )
        resumed = engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=180),
        )
        self.assertEqual(resumed.wrong_direction_seconds[(1, 102)], 60.0)
        self.assertTrue(any(item.kind is ChangeKind.ALERT_OPENED for item in resumed.changes))

    def test_common_reversal_updates_baseline_without_alert_or_removal(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.COUNTERCLOCKWISE),
            START,
            fallback_direction=Direction.COUNTERCLOCKWISE,
        )
        reversed_result = engine.update_group(
            GROUP_ID,
            _pair(Direction.CLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=10),
        )
        self.assertEqual(reversed_result.changes, ())
        self.assertEqual(reversed_result.removal_keys, ())
        self.assertEqual(dict(reversed_result.wrong_direction_seconds), {})

        later = engine.update_group(
            GROUP_ID,
            _pair(Direction.CLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=100),
        )
        self.assertEqual(later.changes, ())
        self.assertEqual(later.removal_keys, ())

    def test_checkpoint_round_trip_preserves_open_alert_and_duration(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START,
            fallback_direction=Direction.COUNTERCLOCKWISE,
        )
        engine.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=70),
        )

        restored = SIDirectionLifecycle.from_state(engine.export_state(), self.config)
        result = restored.update_group(
            GROUP_ID,
            _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
            START + timedelta(seconds=120),
        )
        self.assertEqual(result.changes, ())
        self.assertEqual(result.wrong_direction_seconds[(1, 102)], 120.0)

    def test_naive_observation_time_is_rejected(self) -> None:
        engine = SIDirectionLifecycle(self.config)
        with self.assertRaises(ValueError):
            engine.update_group(
                GROUP_ID,
                _pair(Direction.COUNTERCLOCKWISE, Direction.CLOCKWISE),
                datetime(2026, 9, 8, 12, 0),
                fallback_direction=Direction.COUNTERCLOCKWISE,
            )


if __name__ == "__main__":
    unittest.main()
