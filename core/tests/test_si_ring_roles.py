from __future__ import annotations

import unittest

from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)
from bluewolf_core.si_ring_roles import (
    AmbiguousSIRingAssignment,
    NoLegalSIRingAssignment,
    SIRingMemberEvidence,
    resolve_si_ring_assignment,
)
from bluewolf_core.templates import SynchronizationTemplate, TemplateSlot


def _route(route_id: str, radius: float) -> ClosedRoute:
    return ClosedRoute(
        route_id=route_id,
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        canonical_points=(
            CanonicalPoint(radius, 0.0),
            CanonicalPoint(0.0, radius),
            CanonicalPoint(-radius, 0.0),
            CanonicalPoint(0.0, -radius),
        ),
        center_latitude_deg=32.0,
        center_longitude_deg=34.0,
        length_m=8.0 * radius,
        long_axis_a_m=radius,
        short_axis_b_m=radius,
        orientation_deg=0.0,
        estimated_period_s=120.0,
        direction=Direction.COUNTERCLOCKWISE,
        detection_quality=1.0,
    )


def _template(template_id: str = "rings") -> SynchronizationTemplate:
    return SynchronizationTemplate(
        template_id=template_id,
        name=template_id,
        family=RouteFamily.SI,
        slots=(
            TemplateSlot("inner", "A", 0.0, route_role="inner"),
            TemplateSlot("outer-a", "A", 1.0 / 3.0, route_role="outer"),
            TemplateSlot("outer-b", "A", 2.0 / 3.0, route_role="outer"),
        ),
    )


class SIRingRoleTests(unittest.TestCase):
    def test_nested_route_scales_resolve_one_inner_and_two_outer_members(self) -> None:
        members = (
            SIRingMemberEvidence("v3", "A", _route("outer-2", 120.0)),
            SIRingMemberEvidence("v1", "A", _route("inner", 70.0)),
            SIRingMemberEvidence("v2", "A", _route("outer-1", 110.0)),
        )
        assignment = resolve_si_ring_assignment((_template(),), members)
        self.assertEqual(assignment.role_for("v1"), "inner")
        self.assertEqual(assignment.role_for("v2"), "outer")
        self.assertEqual(assignment.role_for("v3"), "outer")

    def test_equal_radius_mixed_roles_are_ambiguous_instead_of_guessed(self) -> None:
        two_role = SynchronizationTemplate(
            template_id="two-role",
            name="two-role",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("inner", "A", 0.0, route_role="inner"),
                TemplateSlot("outer", "A", 0.5, route_role="outer"),
            ),
        )
        members = (
            SIRingMemberEvidence("v1", "A", _route("r1", 100.0)),
            SIRingMemberEvidence("v2", "A", _route("r2", 100.0)),
        )
        with self.assertRaises(NoLegalSIRingAssignment):
            resolve_si_ring_assignment((two_role,), members)

    def test_same_role_does_not_require_artificial_radius_separation(self) -> None:
        outer = SynchronizationTemplate(
            template_id="outer-only",
            name="outer-only",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("o1", "A", 0.0, route_role="outer"),
                TemplateSlot("o2", "A", 0.5, route_role="outer"),
            ),
        )
        members = (
            SIRingMemberEvidence("v1", "A", _route("r1", 100.0)),
            SIRingMemberEvidence("v2", "A", _route("r2", 100.0)),
        )
        assignment = resolve_si_ring_assignment((outer,), members)
        self.assertEqual(dict(assignment.member_roles), {"v1": "outer", "v2": "outer"})

    def test_vehicle_type_constraints_can_make_role_assignment_unique(self) -> None:
        typed = SynchronizationTemplate(
            template_id="typed",
            name="typed",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("inner-b", "B", 0.0, route_role="inner"),
                TemplateSlot("outer-a", "A", 0.5, route_role="outer"),
            ),
        )
        members = (
            SIRingMemberEvidence("a", "A", _route("outer", 100.0)),
            SIRingMemberEvidence("b", "B", _route("inner", 80.0)),
        )
        assignment = resolve_si_ring_assignment((typed,), members)
        self.assertEqual(assignment.role_for("b"), "inner")
        self.assertEqual(assignment.role_for("a"), "outer")

    def test_multiple_legal_templates_are_reported_as_ambiguous(self) -> None:
        first = SynchronizationTemplate(
            template_id="first",
            name="first",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("f1", "A", 0.0, route_role="outer"),
                TemplateSlot("f2", "A", 0.5, route_role="outer"),
            ),
        )
        second = SynchronizationTemplate(
            template_id="second",
            name="second",
            family=RouteFamily.SI,
            slots=(
                TemplateSlot("s1", "A", 0.0, route_role="outer"),
                TemplateSlot("s2", "A", 1.0 / 3.0, route_role="outer"),
            ),
        )
        members = (
            SIRingMemberEvidence("v1", "A", _route("r1", 100.0)),
            SIRingMemberEvidence("v2", "A", _route("r2", 100.0)),
        )
        with self.assertRaises(AmbiguousSIRingAssignment):
            resolve_si_ring_assignment((first, second), members)
        chosen = resolve_si_ring_assignment(
            (first, second),
            members,
            preferred_template_id="second",
        )
        self.assertEqual(chosen.template.template_id, "second")


if __name__ == "__main__":
    unittest.main()
