"""Canonical worker activation with v2.2 historical replay + v2.1 live state.

v2.2 keeps the v2.1 topology/grouping/live semantics and replaces only the
historical window slicing implementation with the indexed replay path. The
public Core API remains 1.0.0.
"""

from . import application_analysis_v22 as _application_analysis_v22
from .live_analysis_v21 import LiveAnalysisSession
from . import worker as _worker

# The base worker owns the stable language-neutral command contract. Replace
# only the current algorithm entry points; transport semantics stay unchanged.
_worker.LiveAnalysisSession = LiveAnalysisSession
_worker.analyze_navigation_dataset = _application_analysis_v22.analyze_navigation_dataset
_worker.build_analysis_history = _application_analysis_v22.build_analysis_history
_worker.derive_events = _application_analysis_v22.derive_events
_worker.so_pair_compatibility = _application_analysis_v22.so_pair_compatibility

CoreWorker = _worker.CoreWorker
main = _worker.main

__all__ = ["CoreWorker", "main"]


if __name__ == "__main__":
    main()
