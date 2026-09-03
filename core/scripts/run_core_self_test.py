from __future__ import annotations

import argparse
from pathlib import Path

from bluewolf_core.selftest import run_self_test


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Blue Wolf foundation self-test")
    parser.add_argument("--output", type=Path, help="optional JSON report path")
    arguments = parser.parse_args()
    rendered = run_self_test().to_json()
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
