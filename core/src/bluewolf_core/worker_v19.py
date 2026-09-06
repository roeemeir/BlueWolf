"""Canonical v1.9 worker activation.

Importing the v1.9 analysis refinement first installs the raw-NAV articulated
Double grouping primitive into the stable v1.8 analysis envelope.  The existing
worker transport and session API are then reused unchanged.
"""

from . import application_analysis_v19 as _application_analysis_v19  # noqa: F401
from .worker import CoreWorker, main

__all__ = ["CoreWorker", "main"]


if __name__ == "__main__":
    main()
