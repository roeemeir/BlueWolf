"""Application-facing adapters around the algorithmic Blue Wolf core.

This package may know about transport/presentation contracts.  The public
``bluewolf_core`` package remains independent of HTTP, UI colors, arenas and
other application concerns.
"""

from .contract import LIVE_RUNTIME_SCHEMA_VERSION, build_so_live_runtime_snapshot

__all__ = ["LIVE_RUNTIME_SCHEMA_VERSION", "build_so_live_runtime_snapshot"]
