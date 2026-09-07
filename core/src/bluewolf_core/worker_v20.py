"""Canonical worker activation with v2.0 analysis + bounded live horizon.

Import order is deliberate: v2.0 installs the current raw-NAV grouping and
local disturbance-estimator primitives, then the base worker's
LiveAnalysisSession reference is replaced by the bounded live-session
implementation. The public Core API remains 1.0.0.
"""

from . import application_analysis_v20 as _application_analysis_v20  # noqa: F401
from .live_analysis_v20 import LiveAnalysisSession
from . import worker as _worker

_worker.LiveAnalysisSession = LiveAnalysisSession

CoreWorker = _worker.CoreWorker
main = _worker.main

__all__ = ["CoreWorker", "main"]


if __name__ == "__main__":
    main()
