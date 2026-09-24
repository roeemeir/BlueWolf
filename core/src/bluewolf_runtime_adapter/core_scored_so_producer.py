"""SO operational publication using selected-template Core score on the same tick.

The ordinary SO producer cannot use a score resolved BEFORE scoring; this
opt-in sibling obtains the score from CoreScoredSOEventRuntime AFTER its one
stateful pass, then publishes exactly that value and its actual event/alert.
No group, binding, template, geometry or vehicle type is inferred here.
"""
from __future__ import annotations

from datetime import UTC, datetime
from types import MappingProxyType

from bluewolf_core.live_so_event_runtime import TemplateComparisonDimension
from bluewolf_core.models import RouteFamily

from .contract import LIVE_RUNTIME_SCHEMA_VERSION, build_so_live_runtime_snapshot
from .core_scored_so import CoreScoredSOEventRuntime
from .ingest_coordinator import IngestPollResult
from .producer import LiveRuntimeProducer, RuntimePublicationResult, _detected_route_payload, _utc


class CoreScoredSOProducer(LiveRuntimeProducer):
    """Publish score/event provenance from one actual selected SO scoring pass."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not isinstance(self.runtime, CoreScoredSOEventRuntime):
            raise ValueError("Core-scored SO producer requires CoreScoredSOEventRuntime")

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        if any(sample.server_id != self.server_id for sample in poll.samples):
            raise ValueError("poll contains samples from a different server")
        grouping = self.session.grouping_snapshot()
        active_so_groups = tuple(
            group for group in grouping.groups
            if group.server_id == self.server_id and group.family is RouteFamily.SO
        )
        active_ids = {group.group_id for group in active_so_groups}
        for ended in sorted(self._structurally_active_groups - active_ids):
            self.runtime.end_group(ended, poll.window.end_time_utc, reason="structural_group_ended")
        self._structurally_active_groups = active_ids
        self.runtime.advance_events(poll.window.end_time_utc)
        sample_index = self._sample_index(poll.samples, self.server_id)
        group_payloads: list[tuple[str, datetime, str, dict[str, object]]] = []
        skipped: dict[str, str] = {}
        for group in sorted(active_so_groups, key=lambda item: item.group_id):
            binding = self.binding_resolver(group)
            if binding is None:
                skipped[group.group_id] = "operational_binding_unavailable"
                continue
            binding_error = self._validate_binding(group, binding)
            if binding_error is not None:
                skipped[group.group_id] = binding_error
                continue
            selected = self._frames_for_group(poll.core_result.frames, group)
            if selected is None:
                skipped[group.group_id] = "no_complete_common_timestamp"
                continue
            observed_at, frames = selected
            members = self._member_inputs(group, binding, observed_at, frames, sample_index)
            if members is None:
                skipped[group.group_id] = "runtime_member_evidence_incomplete_or_route_mismatch"
                continue
            result = self.runtime.process_snapshot(
                group.group_id,
                binding.constellation,
                members,
                reference_period_s=group.base_period_s,
                displayed_group_score=None,
                displayed_score_valid=False,
            )
            # Never substitute a configured/mocked score here. The publisher
            # reads the already-scored value for this exact group and time.
            displayed = self.runtime.latest_displayed(group.group_id, observed_at)
            vehicle_ids = {item.resolved_member_id: item.vehicle_identifier for item in binding.members}
            vehicle_types = {item.resolved_member_id: item.vehicle_type for item in binding.members}
            one = build_so_live_runtime_snapshot(
                result,
                server_id=self.server_id,
                observed_at_utc=observed_at,
                arena=binding.arena,
                displayed_group_score=displayed.score,
                displayed_score_valid=displayed.valid,
                comparison_dimension=TemplateComparisonDimension(self.runtime.comparison_dimension),
                vehicle_ids=vehicle_ids,
                vehicle_type_by_member=vehicle_types,
                group_name=binding.group_name,
                subtitle=binding.subtitle,
                color=binding.color,
            )
            payload = one["groups"]["so"]
            payload["detectedRoutes"] = _detected_route_payload(members)
            group_payloads.append((group.group_id, _utc(observed_at), binding.arena, payload))
        if not group_payloads:
            return RuntimePublicationResult(None, (), skipped)
        arenas = {item[2] for item in group_payloads}
        if len(arenas) != 1:
            raise ValueError("all groups in one server runtime snapshot must share one arena")
        arena = next(iter(arenas))
        group_payloads.sort(key=lambda item: item[0])
        observed_at = max(item[1] for item in group_payloads)
        all_groups = [item[3] for item in group_payloads]
        vehicle_count = sum(len(payload.get("members", [])) for payload in all_groups)
        snapshot: dict[str, object] = {
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": str(self.server_id),
            "arena": arena,
            "status": f"{len(all_groups)} קבוצות SO · {vehicle_count} רכבים",
            "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
            "source": {
                "kind": "python-core",
                "health": "healthy",
                "detail": f"CoreScoredSOProducer · {len(all_groups)} SO groups · real selected-template score",
            },
            "groups": {"so": all_groups[0]},
            "groupList": all_groups,
        }
        self.store.publish(snapshot)
        return RuntimePublicationResult(
            MappingProxyType(snapshot),
            tuple(item[0] for item in group_payloads),
            skipped,
        )


__all__ = ["CoreScoredSOProducer"]
