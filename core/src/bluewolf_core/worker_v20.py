"""Canonical worker activation with v2.1 analysis + v2.1 live session.

Import order is deliberate: v2.1 installs the current raw-NAV grouping,
local disturbance-estimator and robust structural Figure-8 primitives, then the
base worker's LiveAnalysisSession reference is replaced by the bounded,
thread-safe live implementation. The public Core API remains 1.0.0.
"""

from . import application_analysis_v21 as _application_analysis_v21  # noqa: F401
from .live_analysis_v21 import LiveAnalysisSession
from . import worker as _worker

_worker.LiveAnalysisSession = LiveAnalysisSession

CoreWorker = _worker.CoreWorker
main = _worker.main

__all__ = ["CoreWorker", "main"]


if __name__ == "__main__":
    main()
