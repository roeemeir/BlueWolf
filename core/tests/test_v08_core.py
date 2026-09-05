from __future__ import annotations

import math
import unittest
from dataclasses import replace

from bluewolf_core.v08_core import (
    Point2D,
    Rotation,
    RouteKind,
    RouteLifecycle,
    RouteShape,
    SoEntity,
    SoEntityKind,
    SoLayout,
    SoRelation,
    StableGroupLifecycle,
    canonical_so_layout_key,
    classify_route,
    grouping_compatible,
    material_change,
    si_group_compatible,
    so_group_compatible,
    validate_so_layout,
)


def circle(cx: float = 0.0, cy: float = 0.0, rx: float = 100.0, ry: float = 96.0, n: int = 240) -> tuple[Point2D, ...]:
    return tuple(Point2D(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n))


def stadium(x0: float, x1: float, cy: float = 0.0, radius: float = 30.0, n: int = 80) -> tuple[Point2D, ...]:
    top = tuple(Point2D(x0 + (x1 - x0) * i / n, cy + radius) for i in range(n))
    right = tuple(Point2D(x1 + radius * math.cos(math.pi / 2 - math.pi * i / n), cy + radius * math.sin(math.pi / 2 - math.pi * i / n)) for i in range(n))
    bottom = tuple(Point2D(x1 - (x1 - x0) * i / n, cy - radius) for i in range(n))
    left = tuple(Point2D(x0 + radius * math.cos(-math.pi / 2 - math.pi * i / n), cy + radius * math.sin(-math.pi / 2 - math.pi * i / n)) for i in range(n))
    return top + right + bottom + left


def interpolate_closed(control: tuple[Point2D, ...], per_edge: int = 14) -> tuple[Point2D, ...]:
    out: list[Point2D] = []
    for i, a in enumerate(control):
        b = control[(i + 1) % len(control)]
        for k in range(per_edge):
            t = k / per_edge
            out.append(Point2D(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
    return tuple(out)


def dogbone() -> tuple[Point2D, ...]:
    raw = (
        Point2D(-182, 25), Point2D(-174, -28), Point2D(-138, -72), Point2D(-82, -88),
        Point2D(-42, -58), Point2D(-14, -23), Point2D(0, -10), Point2D(21, -34),
        Point2D(62, -72), Point2D(118, -82), Point2D(170, -43), Point2D(184, 8),
        Point2D(162, 55), Point2D(112, 84), Point2D(63, 72), Point2D(26, 38),
        Point2D(2, 14), Point2D(-23, 37), Point2D(-64, 79), Point2D(-119, 88),
        Point2D(-165, 62),
    )
    return interpolate_closed(raw)


def figure_eight(n: int = 300) -> tuple[Point2D, ...]:
    return tuple(
        Point2D(
            150 * math.sin((i + 0.37) * 2 * math.pi / n),
            74 * math.sin(2 * (i + 0.37) * 2 * math.pi / n),
        )
        for i in range(n)
    )


class RouteTopologyTests(unittest.TestCase):
    def test_si(self) -> None:
        d = classify_route(circle(), 46)
        self.assertEqual((d.family, d.shape), (RouteKind.SI, RouteShape.COMPACT))
        self.assertLessEqual(d.axis_ratio, 1.5)
        self.assertNotEqual(d.rotation, Rotation.UNKNOWN)

    def test_single_so(self) -> None:
        d = classify_route(stadium(-120, 120), 72)
        self.assertEqual((d.family, d.shape), (RouteKind.SO, RouteShape.HIPPODROME))
        self.assertGreaterEqual(d.waist_ratio, 0.70)

    def test_double_so_is_continuous_dogbone(self) -> None:
        d = classify_route(dogbone(), 144)
        self.assertEqual((d.family, d.shape), (RouteKind.SO, RouteShape.DOUBLE_HIPPODROME))
        self.assertEqual(d.self_intersections, 0)
        self.assertLess(d.waist_ratio, 0.70)

    def test_figure_eight_topology_wins_over_covariance(self) -> None:
        d = classify_route(figure_eight(), 110)
        self.assertEqual((d.family, d.shape), (RouteKind.SO, RouteShape.FIGURE_EIGHT))
        self.assertGreater(d.self_intersections, 0)


class GroupingTests(unittest.TestCase):
    def test_score_never_changes_grouping(self) -> None:
        a = classify_route(circle(), 46)
        b = classify_route(circle(4, 3, 101, 96), 48)
        self.assertEqual(
            grouping_compatible(a, b, score_a=0, score_b=100),
            grouping_compatible(a, b, score_a=100, score_b=0),
        )
        self.assertTrue(grouping_compatible(a, b))

    def test_si_rotation_center_period_gates(self) -> None:
        a = classify_route(circle(), 46)
        b = classify_route(circle(5, 2), 48)
        self.assertTrue(si_group_compatible(a, b))
        opposite = Rotation.CCW if a.rotation is Rotation.CW else Rotation.CW
        self.assertFalse(si_group_compatible(a, replace(b, rotation=opposite)))
        self.assertFalse(si_group_compatible(a, replace(b, center=Point2D(100, 100))))
        self.assertFalse(si_group_compatible(a, replace(b, period_s=70)))

    def test_so_endpoint_axis_period_gates(self) -> None:
        left = classify_route(stadium(-170, -30, radius=28), 70)
        right = classify_route(stadium(30, 170, radius=28), 72)
        self.assertTrue(so_group_compatible(left, right))
        far = replace(right, endpoints=(Point2D(500, 500), Point2D(650, 500)))
        self.assertFalse(so_group_compatible(left, far))
        self.assertFalse(so_group_compatible(left, replace(right, orientation_deg=80)))
        self.assertFalse(so_group_compatible(left, replace(right, period_s=120)))

    def test_single_double_two_x_period(self) -> None:
        single = classify_route(stadium(-160, -20, radius=28), 70)
        double = classify_route(dogbone(), 140)
        double = replace(
            double,
            orientation_deg=single.orientation_deg,
            endpoints=(single.endpoints[1], Point2D(single.endpoints[1].x + 250, single.endpoints[1].y)),
        )
        self.assertTrue(so_group_compatible(single, double))


class SoLegalityTests(unittest.TestCase):
    def test_minimum_and_capacities(self) -> None:
        with self.assertRaises(ValueError):
            validate_so_layout(SoLayout((SoEntity(SoEntityKind.SINGLE, 1),), ()))
        with self.assertRaises(ValueError):
            validate_so_layout(SoLayout((SoEntity(SoEntityKind.SINGLE, 3),), ()))
        validate_so_layout(SoLayout((SoEntity(SoEntityKind.DOUBLE, 4),), ()))
        with self.assertRaises(ValueError):
            validate_so_layout(SoLayout((SoEntity(SoEntityKind.FIGURE_EIGHT, 3),), ()))

    def test_mixed_only_next_to_double(self) -> None:
        with self.assertRaises(ValueError):
            validate_so_layout(
                SoLayout(
                    (SoEntity(SoEntityKind.SINGLE, 1), SoEntity(SoEntityKind.FIGURE_EIGHT, 1)),
                    (SoRelation.MIXED,),
                )
            )
        validate_so_layout(
            SoLayout(
                (SoEntity(SoEntityKind.SINGLE, 1), SoEntity(SoEntityKind.DOUBLE, 2)),
                (SoRelation.MIXED,),
            )
        )

    def test_mirror_duplicate_key(self) -> None:
        a = SoLayout(
            (
                SoEntity(SoEntityKind.SINGLE, 1, ("storm",)),
                SoEntity(SoEntityKind.DOUBLE, 2, ("lightning", "thunder")),
            ),
            (SoRelation.OPPOSITE,),
        )
        b = SoLayout(tuple(reversed(a.entities)), tuple(reversed(a.relations)))
        self.assertEqual(canonical_so_layout_key(a), canonical_so_layout_key(b))


class RouteLifecycleTests(unittest.TestCase):
    def test_candidate_confirm_revision_and_bounded_history(self) -> None:
        base = classify_route(circle(), 46)
        changed = replace(base, period_s=60)
        life = RouteLifecycle()
        events = []
        for second in range(0, 321, 5):
            events.extend(life.push(second, base))
        self.assertIn(("route_candidate", 60), [(e.kind, e.at_s) for e in events])
        self.assertIn(("route_confirmed", 300), [(e.kind, e.at_s) for e in events])
        revision_events = []
        for second in range(325, 451, 5):
            revision_events.extend(life.push(second, changed))
        self.assertIn(("route_revision_candidate", 325), [(e.kind, e.at_s) for e in revision_events])
        self.assertIn(("route_revised", 445), [(e.kind, e.at_s) for e in revision_events])
        for second in range(455, 1801, 5):
            life.push(second, changed)
        self.assertLessEqual(len(life.history), 121)
        self.assertGreaterEqual(life.history[0][0], 1200)

    def test_subthreshold_change_does_not_revision(self) -> None:
        base = classify_route(circle(), 46)
        self.assertFalse(material_change(base, replace(base, period_s=50)))


class GroupEventLifecycleTests(unittest.TestCase):
    def test_group_confirmation_opens_event_after_120_seconds(self) -> None:
        life = StableGroupLifecycle()
        events = []
        for second in range(0, 126, 5):
            events.extend(life.update(second, ("101", "102", "103")))
        self.assertIn("group_confirmed", [e.kind for e in events])
        self.assertIn("event_opened", [e.kind for e in events])
        opened = next(e for e in events if e.kind == "event_opened")
        self.assertEqual(opened.at_s, 120)

    def test_short_disconnect_is_held_and_not_new_event(self) -> None:
        life = StableGroupLifecycle()
        for second in range(0, 126, 5):
            life.update(second, ("101", "102", "103"))
        events = []
        for second in range(130, 300, 5):
            events.extend(life.update(second, ("101", "102")))
        self.assertNotIn("event_closed", [e.kind for e in events])
        self.assertEqual(life.confirmed_members, frozenset(("101", "102", "103")))

    def test_confirmed_membership_change_creates_event_boundary(self) -> None:
        life = StableGroupLifecycle(membership_hold_seconds=30)
        for second in range(0, 126, 5):
            life.update(second, ("101", "102", "103"))
        events = []
        for second in range(130, 286, 5):
            events.extend(life.update(second, ("101", "102", "104")))
        kinds = [e.kind for e in events]
        self.assertIn("event_closed", kinds)
        self.assertIn("group_changed", kinds)
        self.assertIn("event_opened", kinds)


if __name__ == "__main__":
    unittest.main()
