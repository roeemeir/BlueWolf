from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_runtime_adapter.event_observation_archive import SOEventObservationArchive

from test_live_so_scoring import _constellation, _input, _route, _template, START


class EventTemplateProvenanceTests(unittest.TestCase):
    def test_live_active_template_survives_immutable_archive_and_event_listing(self) -> None:
        default = _template("default")
        bank = SOTemplateBank((SOTemplateBankEntry(default, is_default=True),))
        scorer = LiveSOGroupScorer(SOTemplateSelectionRegistry(bank))
        route = _route(period_s=100.0)
        constellation = _constellation()

        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(Path(directory) / "events.sqlite")
            runtime = LiveSOEventRuntime(
                scorer,
                comparison_dimension=TemplateComparisonDimension.SYNC,
                observation_sink=archive.record_frame,
            )
            members = (
                _input(route, 0.0, START, member_id="m1", vehicle_identifier=1),
                _input(route, 0.0, START, member_id="m2", vehicle_identifier=2),
            )
            result = runtime.process_snapshot(
                "g1",
                constellation,
                members,
                reference_period_s=100.0,
                displayed_group_score=90.0,
                displayed_score_valid=True,
            )

            frames = archive.read_event(result.event.snapshot.event_id)
            self.assertEqual(len(frames), 1)
            self.assertEqual(frames[0].active_template_id, "default")
            listing = archive.list_events(1)
            self.assertEqual(len(listing), 1)
            self.assertEqual(listing[0]["activeTemplateId"], "default")

    def test_legacy_event_without_template_provenance_stays_explicitly_missing(self) -> None:
        from bluewolf_core.event_recompute import SOEventObservationFrame

        with TemporaryDirectory() as directory:
            archive = SOEventObservationArchive(Path(directory) / "events.sqlite")
            archive.record_frame(
                SOEventObservationFrame(
                    event_id="legacy-event",
                    server_id=1,
                    group_id="legacy-group",
                    sample_time_utc=START,
                    observations=(),
                    pending_reason="core_observations_incomplete",
                )
            )
            listing = archive.list_events(1)
            self.assertIsNone(listing[0]["activeTemplateId"])


if __name__ == "__main__":
    unittest.main()
