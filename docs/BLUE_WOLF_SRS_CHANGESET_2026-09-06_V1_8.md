# Blue Wolf — SRS Amendment v1.8

**Date:** 2026-09-06  
**Status:** Normative functional/architecture amendment.  
**Applies after:** SRS v1.7 canonical architecture.

## 1. Figure-8 route semantics

A **Figure-8 is an SO hippodrome with crossed straight legs**. It is not a new route family.

Normative behavior:
- Family remains `SO`.
- It is one route entity with two ordinary hippodrome end turns.
- The first straight leg connects one side of the first turn to the opposite side of the second turn.
- The second straight leg connects the remaining two sides, so the two legs cross once internally.
- The self-crossing is an internal topology property only; externally the route has the same main axis/end-turn grouping semantics as a single hippodrome.
- Public route kind may be reported as `figure8` and geometry shall expose `crossedLegs=true` when recognized.
- A Figure-8 has one normal SO traversal period. It must not be assigned the doubled period used for a Double-Hippodrome route.
- Phase/progress is normalized arc length along the learned crossed closed polyline.
- At the crossing, branch selection must use motion/tangent evidence so phase does not jump to the other crossing leg merely because both segments occupy the same position.
- Figure-8 may participate in normal SO grouping with compatible single/other supported SO entities according to the existing geometry/period rules. Score must never determine grouping membership.

## 2. Generic route preservation

Recognized topology shall not force measured navigation into an unrelated ideal shape.

- Compact/near-round closed routes retain SI semantics.
- Polygonal and irregular closed routes use generic ordered closed polyline/arc-length behavior.
- Figure-8 retains its self-crossing topology.
- Exact duplicate samples at segment/turn joins are representation artifacts and may be de-duplicated for resampling; this must not alter the learned route geometry.

## 3. Live Python Core execution

Operator Live mode shall use a long-lived canonical Python `CoreSession`.

Required sequence:
1. On first activation of a server/source/configuration/window, send one bounded warm-up NavigationDataset to Python Core.
2. Keep the Core session alive.
3. On each live poll, send only navigation samples newer than the previous accepted timestamp.
4. Default live poll/batch cadence is 5 seconds.
5. Overlapping source queries are allowed; duplicate `(server, vehicle, timestamp)` samples must not be processed twice.
6. Moving the simulation/playhead backwards, or changing the effective Core configuration/window identity, shall create/re-warm an appropriate session rather than corrupting an existing forward session.
7. Multiple UI consumers of the same live cutoff (for example current analysis and timeline) must share the same in-flight Core request where practical and shall not independently process the same batch.

There is no TypeScript algorithm fallback. If the Python Core service/session is unavailable, the UI reports Core unavailable/no analysis.

## 4. Live state and retention

`CoreSession` owns only algorithm state. The application-analysis layer may retain a bounded joined-NAV window in memory for current route fitting, display evidence and timeline construction.

- This NAV window is reconstructible and is not a permanent Blue Wolf data source.
- It must not be embedded in the compact Core checkpoint.
- Historical InfluxDB remains the source of truth for real NAV.

## 5. Checkpoint and recovery

- Persist a compact Core checkpoint every 5 minutes.
- On restart, restore the checkpoint and rehydrate the required recent NAV window from InfluxDB/replay before returning to normal 5-second live batches.
- Recovery/replay must not double-process samples already represented by the checkpoint frontier.
- Restored execution and uninterrupted execution must be equivalent at the same cutoff, subject only to explicitly versioned Core behavior.

## 6. Historical Investigation

Investigation remains a fresh current-Core Replay of the selected source/time range. It does **not** reuse the live mutable session as historical truth.

This guarantees that replacing the Core changes future retrospective analysis consistently without storing a permanent second set of automatic historical scores/events.

## 7. Missing-value truth rule

Missing source fields remain missing unless a documented ingest/interpolation rule with evidence supplies a value.

Specifically, missing Influx altitude must remain `null`/unavailable; it must not silently become `0` merely to satisfy a type or display contract.

## 8. Required validation

Core-only validation shall include:
- crossed-leg Figure-8 direct topology detection;
- Figure-8 through the active application analysis envelope;
- Figure-8 + single-hippodrome external grouping compatibility;
- stable phase at/near the self-crossing using tangent/motion evidence;
- compact SI regression protection;
- warm-up followed by overlapping 5-second batches accepts only new samples;
- incremental execution equals one-shot execution at the same final NAV cutoff;
- compact checkpoint excludes display NAV and restore uses replay.

Integrated release validation shall additionally prove:
- Web Operator uses Python live-session RPC rather than the TypeScript compatibility Core;
- historical Investigation remains stateless current-Core Replay;
- missing Influx altitude is not fabricated;
- public Browser QA and persistence contracts remain green.
