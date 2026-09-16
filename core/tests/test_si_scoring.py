from __future__ import annotations

from bluewolf_core.models import PrimitiveMetrics, RouteFamily
from bluewolf_core.si_scoring import SIScoringMemberInput, score_si_template
from bluewolf_core.templates import ObservedMember, SynchronizationTemplate, TemplateSlot


def _metrics() -> PrimitiveMetrics:
    return PrimitiveMetrics(
        family=RouteFamily.SI,
        position_error=999.0,  # must be replaced by the template fit
        period_error_ratio=0.0,
        movement_error_ratio=0.0,
        distance_error_b_ratio=0.0,
        tangent_error_deg=0.0,
        curvature_error_ratio=0.0,
        reliability=1.0,
        speed_fraction=1.0,
    )


def _template(template_id: str, second_offset: float) -> SynchronizationTemplate:
    return SynchronizationTemplate(
        template_id=template_id,
        name=template_id,
        family=RouteFamily.SI,
        slots=(
            TemplateSlot("slot-a", "outer", 0.0),
            TemplateSlot("slot-b", "outer", second_offset),
        ),
    )


def test_bw_sync_012_si_template_position_changes_raw_member_and_group_score() -> None:
    members = (
        SIScoringMemberInput(ObservedMember("v1", "outer", 0.0), _metrics()),
        SIScoringMemberInput(ObservedMember("v2", "outer", 1.0 / 3.0), _metrics()),
    )

    exact = score_si_template(_template("exact-120", 1.0 / 3.0), members)
    changed = score_si_template(_template("changed-90", 1.0 / 4.0), members)

    assert exact.group_scores.valid is True
    assert changed.group_scores.valid is True
    assert exact.group_scores.sync == 100.0
    assert exact.group_scores.total == 100.0
    assert changed.group_scores.sync < exact.group_scores.sync
    assert changed.group_scores.total < exact.group_scores.total
    assert changed.fit.mean_position_error_cycle > exact.fit.mean_position_error_cycle
    assert all(score.components is not None for score in changed.member_scores.values())
    assert all(
        score.components.sync_position < 100.0
        for score in changed.member_scores.values()
        if score.components is not None
    )


def test_bw_sync_012_template_fit_overrides_stale_display_or_input_position_error() -> None:
    members = (
        SIScoringMemberInput(ObservedMember("v1", "outer", 0.0), _metrics()),
        SIScoringMemberInput(ObservedMember("v2", "outer", 1.0 / 3.0), _metrics()),
    )
    result = score_si_template(_template("exact-120", 1.0 / 3.0), members)

    # The input metric intentionally contains position_error=999.  The score is
    # nevertheless perfect because the raw score uses the fitted SI template.
    assert result.group_scores.sync == 100.0
    for score in result.member_scores.values():
        assert score.valid is True
        assert score.components is not None
        assert score.components.sync_position == 100.0
        assert score.primary_reason is None
