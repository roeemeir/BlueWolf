"""Legacy import shim for the former SO-first mixed runtime factory.

The canonical implementation is now ``family_environment_factory`` and always
builds SI/SO through one neutral sibling-family path. This module exists only so
older deployment/import references continue to start safely during migration.
"""
from __future__ import annotations

from .family_environment_factory import (
    build_operational_runtime,
    build_operational_runtime_from_environment,
)
from .family_runtime import FamilyRuntimeHost

# Historical name retained as an import alias only. New code and checkpoints use
# FamilyRuntimeHost and do not expose SO-specific runtime state at server level.
MixedRuntimeProducer = FamilyRuntimeHost

__all__ = [
    "FamilyRuntimeHost",
    "MixedRuntimeProducer",
    "build_operational_runtime",
    "build_operational_runtime_from_environment",
]
