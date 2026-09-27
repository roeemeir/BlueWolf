"""Fail closed when TEST navigation could contaminate real operational storage.

Synthetic positions are intentionally processed and archived by the *same* Core
pipeline as Influx input, so archival bytes cannot be distinguished later by
looking at the VehicleSample alone. A TEST deployment must use an explicit
isolated storage root for every writable/persistent store it configures.
"""
from __future__ import annotations

from collections.abc import Mapping
import os
from pathlib import Path
from typing import Any


_PERSISTENT_ENV_PATHS = (
    "BLUEWOLF_SAMPLE_ARCHIVE_PATH",
    "BLUEWOLF_OPERATIONAL_STATE_PATH",
    "BLUEWOLF_WORKSPACE_DB",
)


def _text_path(value: object, label: str) -> Path | None:
    if value is None or value == "":
        return None
    if not isinstance(value, (str, os.PathLike)):
        raise ValueError(f"{label} must be a file path")
    raw = os.fspath(value)
    if not raw.strip():
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        # Relative paths depend on the service working directory, which may
        # differ between the deployment CLI, UI and background runtime.
        raise ValueError(f"{label} must be an absolute TEST file path")
    return path.resolve(strict=False)


def assert_simulation_storage_isolated(
    config: Mapping[str, Any], *, environment: Mapping[str, str] | None = None
) -> None:
    """Validate all known source-bound persistence locations before polling.

    With no persistent destination configured, an in-memory simulation needs
    no test storage root. If *any* archive/checkpoint/workspace path exists,
    BLUEWOLF_TEST_STORAGE_ROOT must be explicitly set and every configured
    destination must be strictly beneath that directory, not the directory
    itself or an escaping symlink. This prevents a correctly labeled test
    snapshot from leaving indistinguishable synthetic samples in production
    SQLite, including when an environment override wins over JSON config.
    """
    env = os.environ if environment is None else environment
    paths: list[tuple[str, Path]] = []
    for section_name in ("archive", "persistence"):
        raw_section = config.get(section_name)
        if raw_section is None:
            continue
        if not isinstance(raw_section, Mapping):
            raise ValueError(f"{section_name} must be an object")
        path = _text_path(raw_section.get("path"), f"{section_name}.path")
        if path is not None:
            paths.append((f"{section_name}.path", path))
    for key in _PERSISTENT_ENV_PATHS:
        path = _text_path(env.get(key), key)
        if path is not None:
            paths.append((key, path))
    if not paths:
        return
    root = _text_path(env.get("BLUEWOLF_TEST_STORAGE_ROOT"), "BLUEWOLF_TEST_STORAGE_ROOT")
    if root is None:
        raise ValueError("simulation with persistent storage requires BLUEWOLF_TEST_STORAGE_ROOT")
    if root == Path(root.anchor) or root == Path.home().resolve(strict=False):
        raise ValueError("BLUEWOLF_TEST_STORAGE_ROOT must be a dedicated test directory")
    for label, path in paths:
        if root not in path.parents:
            raise ValueError(f"{label} escapes BLUEWOLF_TEST_STORAGE_ROOT")


__all__ = ["assert_simulation_storage_isolated"]
