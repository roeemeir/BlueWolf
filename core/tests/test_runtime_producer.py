from __future__ import annotations

import unittest
from datetime import timedelta

from bluewolf_core.grouping import GroupingSnapshot, RouteGroup
from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.models import CoreBatchResult, RouteFamily, VehicleFrameResult
from bluewolf_core.semantic_session import CoreSession
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_ingest.polling import PollWindow
from bluewolf_runtime_adapter.ingest_coordinator import IngestPollResult
from bluewolf_runtime_adapter.producer import (
    DisplayedScoreValue,
    LiveRuntimeProducer,
    SOOperationalGroupBinding,
    SOOperationalMemberBinding,
)
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

from test_live_so_scoring import START, _constellation, _input, _route, _template


class _Session:
    def __init__(self, groups, routes):
        self._groups = tuple(groups)
        self._routes = dict(routes)

    def grouping_snapshot(self):
        return GroupingSnapshot(
            self._groups,
            {
                key: group.group_id
                for group in self._groups
                for key in group.member_keys
            },
        )

    def confirmed_route(self, server_id: int, vehicle_identifier: int):
        return self._routes.get((server_id, vehicle_identifier))


def _runtime():
    template = _template("default")
    bank = SOTemplateBank((SOTemplateBankEntry(template, is_default=True),))
    registry = SOTemplateSelectionRegistry(bank)
    scorer = LiveSOGroupScorer(registry)
    return LiveSOEventRuntime(
        scorer,
        comparison_dimension=TemplateComparisonDimension.SYNC,
    )


def _group(group_id: str, first: int, second: int, route) -> RouteGroup:
    return RouteGroup(
        group_id=group_id,
        server_id=1,
        family=RouteFamily.SO,
        member_keys=((1, first), (1, second)),
        route_ids=(route.route_id, route.route_id),
        base_period_s=route.estimated_period_s,
    )


def _binding(group_id: str, first: int, second: int, route) -> SOOperationalGroupBinding:
    speed = route.length_m / route.estimated_period_s
    return SOOperationalGroupBinding(
        group_id=group_id,
        constellation=_constellation(),
        members=(
            SOOperationalMemberBinding(first, "A", "r1", speed),
            SOOperationalMemberBinding(second, "A", "r1", speed),
        ),
        arena="Arena A",
        group_name=f"Group {group_id}",
    )


def _poll(groups, route, seconds: int, *, wrong_route_for: int | None = None):
    when = START + timedelta(seconds=seconds)
    samples = []
    frames = []
    for group in groups:
        identifiers = [key[1] for key in group.member_keys]
        phases = (seconds / 100.0, (seconds / 100.0 + 0.5) % 1.0)
        for vehicle_identifier, phase in zip(identifiers, phases, strict=True):
            item = _input(
                route,
                phase,
                when,
                member_id=str(vehicle_identifier),
                vehicle_identifier=vehicle_identifier,
            )
            sample = item.sample
            samples.append(sample)
            frames.append(
                VehicleFrameResult(
                    sample_time_utc=when,
                    server_id=1,
                    vehicle_identifier=vehicle_identifier,
                    active=True,
                    latitude_deg=sample.latitude_deg,
                    longitude_deg=sample.longitude_deg,
                    reliability=sample.reliability,
                    group_id=group.group_id,
                    route_id=(
                        "wrong-route"
                        if wrong_route_for == vehicle_identifier
                        else route.route_id
                    ),
                    semantic_phase=phase,
                )
            )
    core = CoreBatchResult(
        schema_version=1,
        algorithm_version="test",
        frames=tuple(frames),
        changes=(),
        processed_until_utc=when,
    )
    return IngestPollResult(
        window=PollWindow(when, when),
        samples=tuple(samples),
        core_result=core,
        server_awake=True,
    )


class LiveRuntimeProducerTests(unittest.TestCase):
    def test_two_so_groups_are_preserved_without_family_key_overwrite(self) -> None:
        route = _route(period_s=100.0)
        groups = (_group("g1", 1, 2, route), _group("g2", 3, 4, route))
        session = _Session(
            groups,
            {(1, identifier): route for identifier in (1, 2, 3, 4)},
        )
        bindings = {
            "g1": _binding("g1", 1, 2, route),
            "g2": _binding("g2", 3, 4, route),
        }
        store = RuntimeSnapshotStore()
        producer = LiveRuntimeProducer(
            server_id=1,
            session=session,  # type: ignore[arg-type]
            runtime=_runtime(),
            store=store,
            binding_resolver=lambda group: bindings.get(group.group_id),
            displayed_score_resolver=lambda _group_id, _when: DisplayedScoreValue(88.0, True),
        )

        producer.publish_poll(_poll(groups, route, 0))
        result = producer.publish_poll(_poll(groups, route, 5))

        self.assertEqual(result.published_group_ids, ("g1", "g2"))
        assert result.snapshot is not None
        group_list = result.snapshot["groupList"]
        self.assertEqual([group["id"] for group in group_list], ["g1", "g2"])
        self.assertEqual(result.snapshot["groups"]["so"]["id"], "g1")
        stored = store.get("1")
        assert stored is not None
        self.assertEqual(len(stored["groupList"]), 2)
        self.assertTrue(all(group["scoreValid"] for group in stored["groupList"]))

    def test_missing_binding_is_explicitly_skipped_not_inferred(self) -> None:
        route = _route(period_s=100.0)
        groups = (_group("g1", 1, 2, route), _group("g2", 3, 4, route))
        session = _Session(
            groups,
            {(1, identifier): route for identifier in (1, 2, 3, 4)},
        )
        store = RuntimeSnapshotStore()
        producer = LiveRuntimeProducer(
            server_id=1,
            session=session,  # type: ignore[arg-type]
            runtime=_runtime(),
            store=store,
            binding_resolver=(
                lambda group: _binding("g1", 1, 2, route)
                if group.group_id == "g1"
                else None
            ),
            displayed_score_resolver=lambda _group_id, _when: DisplayedScoreValue(90.0, True),
        )

        result = producer.publish_poll(_poll(groups, route, 0))

        self.assertEqual(result.published_group_ids, ("g1",))
        self.assertEqual(result.skipped_groups["g2"], "operational_binding_unavailable")
        assert result.snapshot is not None
        self.assertEqual(len(result.snapshot["groupList"]), 1)

    def test_route_mismatch_fails_closed_and_does_not_publish(self) -> None:
        route = _route(period_s=100.0)
        group = _group("g1", 1, 2, route)
        session = _Session((group,), {(1, 1): route, (1, 2): route})
        store = RuntimeSnapshotStore()
        producer = LiveRuntimeProducer(
            server_id=1,
            session=session,  # type: ignore[arg-type]
            runtime=_runtime(),
            store=store,
            binding_resolver=lambda _group: _binding("g1", 1, 2, route),
            displayed_score_resolver=lambda _group_id, _when: DisplayedScoreValue(90.0, True),
        )

        result = producer.publish_poll(
            _poll((group,), route, 0, wrong_route_for=1)
        )

        self.assertIsNone(result.snapshot)
        self.assertEqual(
            result.skipped_groups["g1"],
            "runtime_member_evidence_incomplete_or_route_mismatch",
        )
        self.assertIsNone(store.get("1"))

    def test_semantic_session_confirmed_route_accessor_is_fail_closed(self) -> None:
        session = CoreSession()
        self.assertIsNone(session.confirmed_route(1, 99))
        with self.assertRaises(ValueError):
            session.confirmed_route(-1, 99)
        with self.assertRaises(ValueError):
            session.confirmed_route(1, -1)


if __name__ == "__main__":
    unittest.main()
