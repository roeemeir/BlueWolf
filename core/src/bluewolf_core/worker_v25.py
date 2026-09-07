"""Canonical worker activation for Blue Wolf Core v2.5 internals.

Public Core API remains 1.0.0. v2.5 keeps 40 minutes of reconstructible NAV
while current route fitting/scoring uses the latest cycle and initial route
confirmation no longer waits for the legacy fixed five-minute gate.
"""

from . import application_analysis_v25 as _analysis
from . import live_analysis as _live_base
from . import live_analysis_v21 as _live_v21
from . import worker as _worker
from .session_v25 import CoreSession, ROUTE_HISTORY_SECONDS

_live_base.analyze_navigation_dataset = _analysis.analyze_navigation_dataset
_live_base.derive_events = _analysis.derive_events
_live_base._ROUTE_HISTORY_SECONDS = ROUTE_HISTORY_SECONDS
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
