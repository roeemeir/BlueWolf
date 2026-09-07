"""Canonical worker activation for Blue Wolf Core v2.3 internals.

Public Core API remains 1.0.0. v2.3 activates:
- application analysis v2.3 (multi-group SI/SO, turn-connected SO, indexed history),
- 40-minute route-history CoreSession,
- thread-safe live session with the same application analysis functions.
"""

from . import application_analysis_v23 as _analysis
from . import live_analysis as _live_base
from . import live_analysis_v21 as _live_v21
from . import worker as _worker
from .session_v23 import CoreSession

# Methods on LiveAnalysisSession resolve these globals in live_analysis at call
# time, so replace the pure analysis primitives without duplicating session code.
_live_base.analyze_navigation_dataset = _analysis.analyze_navigation_dataset
_live_base.derive_events = _analysis.derive_events
_live_base._ROUTE_HISTORY_SECONDS = 40 * 60
_live_base.CoreSession = CoreSession

LiveAnalysisSession = _live_v21.LiveAnalysisSession

# Replace worker module-level imports with the v2.3 canonical implementation.
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
