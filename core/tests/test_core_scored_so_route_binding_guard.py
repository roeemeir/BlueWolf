"""Fail-closed route-instance metadata must not take down valid sibling SO groups.

The group/route identities in this test are explicit fixtures. Navigation-only
Core confirmation is independently exercised by test_navigation_core_so_full_path.
"""
from __future__ import annotations

from dataclasses import replace
import unittest

from bluewolf_core.live_so_event_runtime import TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_runtime_adapter.core_scored_so import CoreScoredSOEventRuntime
from bluewolf_runtime_adapter.core_scored_so_producer import CoreScoredSOProducer
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_live_so_scoring import _route, _template
from test_runtime_producer import _Session, _binding, _group, _poll


class RouteInstanceBindingGuardTests(unittest.TestCase):
    def test_conflicting_route_instance_skips_only_bad_group_before_scoring(self):
        route = _route(period_s=100.0)
        other_route = replace(route, route_id="independently-confirmed-other-route")
        groups = (_group("bad", 1, 2, route), _group("good", 3, 4, route))
        session = _Session(groups, {
            (1, 1): route, (1, 2): other_route,
            (1, 3): route, (1, 4): route,
        })
        bindings = {
            "bad": _binding("bad", 1, 2, route),
            "good": _binding("good", 3, 4, route),
        }
        bank = SOTemplateBank((SOTemplateBankEntry(_template("default"), is_default=True),))
        runtime = CoreScoredSOEventRuntime(
            LiveSOGroupScorer(SOTemplateSelectionRegistry(bank)),
            comparison_dimension=TemplateComparisonDimension.SYNC,
        )
        store = RuntimeSnapshotStore()
        producer = CoreScoredSOProducer(
            server_id=1, session=session, runtime=runtime, store=store,
            binding_resolver=lambda group: bindings.get(group.group_id),
            displayed_score_resolver=lambda *_: (_ for _ in ()).throw(
                AssertionError("Core-scored SO must not fetch external scores")
            ),
        )
        for elapsed in (0, 5):
            poll = _poll(groups, route, elapsed)
            # Match the second fixture's independently confirmed Core route ID
            # in its actual frame; otherwise the normal frame/route guard would
            # correctly skip it before exercising the route-instance conflict.
            frames = tuple(
                replace(frame, route_id=other_route.route_id)
                if frame.vehicle_identifier == 2 else frame
                for frame in poll.core_result.frames
            )
            poll = replace(poll, core_result=replace(poll.core_result, frames=frames))
            outcome = producer.publish_poll(poll)
            self.assertEqual(outcome.published_group_ids, ("good",))
            self.assertEqual(
                outcome.skipped_groups["bad"],
                "binding_route_instance_conflicts_with_confirmed_core_routes",
            )
            self.assertIsNone(runtime.event_engine.snapshot("bad"),
                              "a failed binding cannot leave a live scored event")
            latest = store.get("1")
            self.assertEqual([group["id"] for group in latest["groupList"]], ["good"])
            self.assertEqual(latest["source"]["kind"], "python-core")
            self.assertEqual({row["id"] for row in latest["groupList"][0]["members"]}, {3, 4})
        self.assertTrue(store.get("1")["groupList"][0]["scoreValid"],
                        "the unaffected sibling must still progress to a real score")


if __name__ == "__main__":
    unittest.main()
