from __future__ import annotations

from datetime import UTC, datetime

from bluewolf_core import CoreSession
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


def main() -> None:
    samples = generate_si_circle_samples(
        start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
        duration_seconds=30,
        vehicles=(
            SimulatedVehicle(1, 101, 0),
            SimulatedVehicle(2, 102, 120),
            SimulatedVehicle(3, 103, 240),
        ),
    )
    session = CoreSession()
    result = session.process_batch(samples)
    print(f"frames={len(result.frames)} changes={len(result.changes)}")
    print(f"processed_until={result.processed_until_utc.isoformat()}")
    print(f"checkpoint_bytes={len(session.export_checkpoint())}")


if __name__ == "__main__":
    main()

