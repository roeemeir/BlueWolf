"""Compose bounded InfluxDB2 reads with the validated temporal join.

Live polling and after-action replay both need the same boundary semantics. A
requested logical window is expanded by the join tolerance before the Influx
query. The extra source points are used only as interpolation/forward-fill
evidence; ``join_metric_points`` clips returned samples to the requested window.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from bluewolf_core.models import VehicleSample

from .influxdb2 import InfluxDB2Adapter
from .join import TemporalJoinConfig, join_metric_points


@dataclass(slots=True)
class InfluxDB2WindowReader:
    adapter: InfluxDB2Adapter
    join_config: TemporalJoinConfig = TemporalJoinConfig()

    def read_samples(
        self,
        *,
        server_id: int,
        server_tag_value: str | None,
        start_time_utc: datetime,
        end_time_utc: datetime,
    ) -> tuple[VehicleSample, ...]:
        if start_time_utc.tzinfo is None or end_time_utc.tzinfo is None:
            raise ValueError("window bounds must be timezone-aware")
        if end_time_utc < start_time_utc:
            raise ValueError("end_time_utc must not precede start_time_utc")

        tolerance = timedelta(seconds=self.join_config.tolerance_seconds)
        # Flux range stop is exclusive. One microsecond keeps an original that
        # lands exactly on the +tolerance boundary eligible for the join.
        raw_start = start_time_utc - tolerance
        raw_stop = end_time_utc + tolerance + timedelta(microseconds=1)
        points = self.adapter.query_points(
            server_id=server_id,
            server_tag_value=server_tag_value,
            start_time_utc=raw_start,
            stop_time_utc=raw_stop,
        )
        return join_metric_points(
            points,
            config=self.join_config,
            start_time_utc=start_time_utc,
            end_time_utc=end_time_utc,
        )


__all__ = ["InfluxDB2WindowReader"]
