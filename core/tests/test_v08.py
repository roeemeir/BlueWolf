from __future__ import annotations

import math
import unittest
from dataclasses import replace

from bluewolf_core.v08 import (
    Point2D,
    Rotation,
    RouteKind,
    RouteLifecycleV08,
    RouteShape,
    SoEntity,
    SoEntityKind,
    SoLayout,
    SoRelation,
    canonical_so_layout_key,
    classify_route,
    grouping_compatible,
    material_change,
    si_group_compatible,
    so_group_compatible,
    validate_so_layout,
)


def circle(cx: float = 0.0, cy: float = 0.0, rx: float = 100.0, ry: float = 96.0, n: int = 240) -> tuple[Point2D, ...]:
    return tuple(
        Point2D(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n))
        for i in range(n)
    )


def stadium(x0: float, x1: float, cy: float = 0.0, radius: float = 30.0, n_turn: int = 70, n_leg: int = 70) -> tuple[Point2D, ...]:
    # Counter-clockwise stadium with turn centres at x0/x1.
    top = tuple(Point2D(x0 + (x1 - x0) * i / n_leg, cy + radius) for i in range(n_leg))
    right = tuple(
        Point2D(x1 + radius * math.cos(math.pi / 2 - math.pi * i / n_turn), cy + radius * math.sin(math.pi / 2 - math.pi * i / n_turn))
        for i in range(n_turn)
    )
    bottom = tuple(Point2D(x1 - (x1 - x0) * i / n_leg, cy - radius) for i in range(n_leg))
    left = tuple(
        Point2D(x0 + radius * math.cos(-math.pi / 2 - math.pi * i / n_turn), cy + radius * math.sin(-math.pi / 2 - math.pi * i / n_turn))
        for i in range(n_turn)
    )
    return top + right + bottom + left


def interpolate_closed(control: tuple[Point2D, ...], per_edge: int = 10) -> tuple[Point2D, ...]:
    output: list[Point2D] = []
    for index, a in enumerate(control):
        b = control[(index + 1) % len(control)]
        for step in range(per_edge):
            t = step / per_edge
            output.append(Point2D(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
    return tuple(output)


def double_hippodrome() -> tuple[Point2D, ...]:
    # Authoritative dog-bone idea: one continuous bent route with a narrow
    # centre waist, not two independent/overlapping capsules.
    raw = (
        Point2D(-182, 25), Point2D(-174, -28), Point2D(-138, -72), Point2D(-82, -88),
        Point2D(-42, -58), Point2D(-14, -23), Point2D(0, -10), Point2D(21, -34),
        Point2D(62, -72), Point2D(118, -82), Point2D(170, -43), Point2D(184, 8),
        Point2D(162, 55), Point2D(112, 84), Point2D(63, 72), Point2D(26, 38),
        Point2D(2, 14), Point2D(-23, 37), Point2D(-64, 79), Point2D(-119, 88),
        Point2D(-165, 62),
    )
    return interpolate_closed(raw, 12)


def figure_eight(n: int = 260) -> tuple[Point2D, ...]:
    # Phase shift keeps the crossing between sampled vertices so the segment
    # intersection detector sees a proper crossing rather than a shared point.
    return tuple(
        Point2D(
            150 * math.sin((i + 0.31) * 2 * math.pi / n),
            72 * math.sin(2 * (i + 0.31) * 2 * math.pi / n),
        )
        for i in range(n)
    )


class V08RouteClassificationTests(unittest.TestCase):
    def test_compact_si_is_classified_from_geometry(self) -> None:
        route = classify_route(circle(), 46)
        self.assertEqual(route.family, RouteKind.SI)
        self.assertEqual(route.shape, RouteShape.COMPACT)
        self.assertLessEqual(route.axis_ratio, 1.5)
        self.assertIn(route.rotation, (Rotation.CW, Rotation.CCW))

    def test_single_hippodrome_is_not_double(self) -> None:
        route = classify_route(stadium(-115, 115), 72)
        self.assertEqual(route.family, RouteKind.SO)
        self.assertEqual(route.shape, RouteShape.HIPPODROME)
        self.assertGreater(route.axis_ratio, 1.5)

    def test_continuous_dogbone_is_double_hippodrome(self) -> None:
        route = classify_route(double_hippodrome(), 144)
        self.assertEqual(route.family, RouteKind.SO)
        self.assertEqual(route.shape, RouteShape.DOUBLE_HIPPODROME)
        self.assertLess(route.waist_ratio, 0.70)
        self.assertGreaterEqual(route.turn_clusters, 3)

    def test_figure_eight_is_detected_by_topology(self) -> None:
        route = classify_route(figure_eight(), 110)
        self.assertEqual(route.family, RouteKind.SO)
        self.assertEqual(route.shape, RouteShape.FIGURE_EIGHT)
        self.assertGreater(route.self_intersections, 0)


class V08GroupingTests(unittest.TestCase):
    def test_si_requires_same_rotation_center_and_period(self) -> None:
        a = classify_route(circle(0, 0), 46)
        b = classify_route(circle(8, 4, 101, 96), 49)
        self.assertTrue(si_group_compatible(a, b))
        self.assertFalse(si_group_compatible(a, replace(b, rotation=Rotation.CW if a.rotation is Rotation.CCW else Rotation.CCW)))
        self.assertFalse(si_group_compatible(a, replace(b, center=Point2D(90, 90))))
        self.assertFalse(si_group_compatible(a, replace(b, period_s=70)))

    def test_so_requires_endpoint_adjacency_axis_and_period(self) -> None:
        left = classify_route(stadium(-160, -20, radius=28), 70)
        right = classify_route(stadium(20, 160, radius=28), 72)
        self.assertTrue(so_group_compatible(left, right))
        self.assertFalse(so_group_compatible(left, replace(right, endpoints=(Point2D(500, 500), Point2D(650, 500)))))
        self.assertFalse(so_group_compatible(left, replace(right, orientation_deg=80)))
        self.assertFalse(so_group_compatible(left, replace(right, period_s=120)))

    def test_single_double_two_x_period_relation_is_legal(self) -> None:
        single = classify_route(stadium(-160, -20, radius=28), 70)
        double = classify_route(double_hippodrome(), 140)
        # Put one double endpoint next to the single and align its axis for this
        # focused compatibility test.
        double = replace(
            double,
            orientation_deg=single.orientation_deg,
            endpoints=(single.endpoints[1], Point2D(single.endpoints[1].x + 250, single.endpoints[1].y)),
        )
        self.assertTrue(so_group_compatible(single, double))

    def test_grouping_is_score_independent(self) -> None:
        a = classify_route(circle(), 46)
        b = classify_route(circle(5, 3), 47)
        self.assertEqual(
            grouping_compatible(a, b, score_a=0, score_b=100),
            grouping_compatible(a, b, score_a=100, score_b=0),
        )


class V08SoTemplateTests(unittest.TestCase):
    def test_so_minimum_two_vehicles(self) -> None:
        with self.assertRaises(ValueError):
            validate_so_layout(SoLayout((SoEntity(SoEntityKind.SINGLE, 1),), ()))

    def test_single_capacity_is_two_and_double_capacity_is_four(self) -> None:
        with self.assertRaises(ValueError):
            validate_so_layout(SoLayout((SoEntity(SoEntityKind.SINGLE, 3),), ()))
        validate_so_layout(SoLayout((SoEntity(SoEntityKind.DOUBLE, 4),), ()))
        with self.assertRaises(ValueError):
            validate_so_layout(SoLayout((SoEntity(SoEntityKind.DOUBLE, 5),), ()))

    def test_mixed_is_only_legal_next_to_double(self) -> None:
        illegal = SoLayout(
            (SoEntity(SoEntityKind.SINGLE, 1), SoEntity(SoEntityKind.FIGURE_EIGHT, 1)),
            (SoRelation.MIXED,),
        )
        with self.assertRaises(ValueError):
            validate_so_layout(illegal)
        legal = SoLayout(
            (SoEntity(SoEntityKind.SINGLE, 1), SoEntity(SoEntityKind.DOUBLE, 2)),
            (SoRelation.MIXED,),
        )
        validate_so_layout(legal)

    def test_mirror_symmetric_layouts_have_same_key(self) -> None:
        a = SoLayout(
            (
                SoEntity(SoEntityKind.SINGLE, 1, ("storm",)),
                SoEntity(SoEntityKind.DOUBLE, 2, ("lightning", "thunder")),
            ),
            (SoRelation.SAME,),
        )
        b = SoLayout(tuple(reversed(a.entities)), tuple(reversed(a.relations)))
        self.assertEqual(canonical_so_layout_key(a), canonical_so_layout_key(b))


class V08LifecycleTests(unittest.TestCase):
    def test_candidate_at_60_confirmation_at_300(self) -> None:
        descriptor = classify_route(circle(), 46)
        lifecycle = RouteLifecycleV08()
        events = []
        for second in range(0, 321, 5):
            events.extend(lifecycle.push(second, descriptor))
        candidate = [event for event in events if event.kind == "route_candidate"]
        confirmed = [event for event in events if event.kind == "route_confirmed"]
        self.assertEqual(len(candidate), 1)
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(candidate[0].at_s, 60)
        self.assertEqual(confirmed[0].at_s, 300)

    def test_revision_requires_material_change_and_120_seconds_stability(self) -> None:
        base = classify_route(circle(), 46)
        changed = replace(base, period_s=60)
        lifecycle = RouteLifecycleV08()
        for second in range(0, 321, 5):
            lifecycle.push(second, base)
        events = []
        for second in range(325, 451, 5):
            events.extend(lifecycle.push(second, changed))
        candidates = [event for event in events if event.kind == "route_revision_candidate"]
        revisions = [event for event in events if event.kind == "route_revised"]
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].at_s, 325)
        self.assertEqual(len(revisions), 1)
        self.assertEqual(revisions[0].at_s, 445)
        self.assertEqual(revisions[0].revision, 1)

    def test_history_is_bounded_after_confirmation(self) -> None:
        descriptor = classify_route(circle(), 46)
        lifecycle = RouteLifecycleV08(history_seconds=600)
        for second in range(0, 1801, 5):
            lifecycle.push(second, descriptor)
        self.assertLessEqual(len(lifecycle.history), 121)
        self.assertGreaterEqual(lifecycle.history[0][0], 1200)

    def test_sub_threshold_change_does_not_revision(self) -> None:
        base = classify_route(circle(), 46)
        small = replace(base, period_s=50)
        self.assertFalse(material_change(base, small))


if __name__ == "__main__":
    unittest.main()
