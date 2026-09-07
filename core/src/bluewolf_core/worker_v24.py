"""Canonical worker activation for Blue Wolf Core v2.4 internals.

Public API remains 1.0.0. v2.4 keeps v2.3 grouping/session behavior and adds
multi-group historical event derivation.
"""

from . import application_analysis_v24 as _analysis
from . import live_analysis as _live_base
from . import live_analysis_v21 as _live_v21
from . import worker as _worker
from .session_v23 import CoreSession

_live_base.analyze_navigation_dataset = _analysis.analyze_navigation_dataset
_live_base.derive_events = _analysis.derive_events
_live_base._ROUTE_HISTORY_SECONDS = 40 * 60
_live_base.CoreSession = CoreSession

LiveAnalysisSession = _live_v21.LiveAnalysisSession

_worker.analyze_navigation_dataset = _analysis.analyze_navigation_dataset
_worker.build_analysis_history = _analysis.build_analysis_history
_worker.derive_events = _analysis.derive_events
_worker.so_pair_compatibility = _analysis.so_pair_compatibility
_worker.CoreSession = CoreSession
_worker.LiveAnalysisSession = LiveAnalysisSession

CoreWorker = _worker.CoreWorker
main = _worker.main

__all__ = ["CoreWorker", "main"]

if __name__ == "__main__":
    main()
