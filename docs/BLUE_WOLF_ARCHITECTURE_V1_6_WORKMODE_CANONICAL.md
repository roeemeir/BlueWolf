# Blue Wolf — Canonical Architecture v1.6 (Work Mode restored)

**Date:** 2026-09-06  
**Status:** Mandatory architecture baseline reconstructed from the original Work Mode / validated DR.  
**Authority rule:** architecture and infrastructure follow the original Work Mode unless explicitly re-decided. Product functionality and UX remain governed by the newest functional SRS amendments (v1.2–v1.5), so newer Template Builder, Operator, Investigation, GT, wind-estimation and map behavior are not rolled back by this document.

## 1. End-to-end topology

`InfluxDB2 / Replay / Simulator -> Ingest + Join -> CoreSession -> Storage/Checkpoint -> Workspace API -> Operator / Investigation / Developer / Calibration`

The major layers intentionally do not overlap:

1. **Data Sources** — InfluxDB2, Replay, Simulator.
2. **Ingest + Join** — normalize, join asynchronous metrics, interpolate where allowed, attach reliability/quality.
3. **Algorithm Core / CoreSession** — route, period, phase/progress, membership, scoring, alerts/events.
4. **Operational Storage** — D1/SQLite, Parquet cache/replay, GT, configuration, events, checkpoints.
5. **Workspace API / Orchestrator** — bootstrap, frame updates, system state, event/config loading and persistence, connection to Core.
6. **UI surfaces** — Operator, Investigation/Replay/PDF, Developer, Calibration/GT/Sweep.

The Core does not know InfluxDB, React/UI, PDF rendering or DB drivers. Source adapters deliver normalized evidence; the UI renders results and system state.

## 2. Normalized navigation contract

The canonical normalized vehicle sample preserves the Work Mode structure and may be extended by later source/provenance fields:

`VehicleSample`
- `vehicle_identifier` — unique real vehicle identifier.
- `sample_time_utc` — source UTC timestamp.
- `latitude`, `longitude`, `altitude` — WGS84 position.
- `velocity_north`, `velocity_east` — source velocity components.
- `active` — active / inactive / unknown when the source can express unknown.
- `reliability` — sample/field reliability.
- `quality_field` — source quality information.
- source/server provenance fields may be appended by adapters.
- projected local `x/y` may be appended after coordinate conversion, but WGS84 evidence remains available.

Simulation, Replay and Influx must enter the Core through the same normalized contract.

## 3. Ingest + Join

The ingestion layer is outside the algorithm Core.

Responsibilities:
- join separately arriving Influx metrics by the agreed identifiers and timestamps;
- hard temporal join tolerance of **5 seconds**;
- interpolation only where permitted by source/reliability policy;
- preserve source timestamps rather than replacing them with UI time;
- attach reliability/quality evidence;
- normalize coordinate and unit conventions before Core processing.

A query returning no rows is a valid no-data state. A query/connection failure is an integration error. Neither state silently falls back to Simulation.

## 4. Logical time, batching and live processing

The Work Mode runtime uses a **1-second logical algorithm time grid**.

Live ingestion is processed in **5-second batches**. A batch represents the ordered samples / logical time points inside that interval; it is **not a five-second average** and must not collapse separate timestamps into one synthetic point.

The session performs a warm-up until enough evidence exists for route/period/group decisions, then repeats ingest -> compute -> publish.

The live application may refresh the map/UI every **2 seconds** while algorithm frames continue on the logical grid.

### Required equivalence
For the same ordered raw navigation evidence and configuration, the Core must be deterministic and regression tests must compare:
- incremental/sample-by-sample processing;
- normal 5-second Batch processing;
- replay/historical batch processing.

Equivalent cutoffs must produce equivalent algorithm state/results within declared numerical tolerances. The UI must never implement a second production algorithm to compensate for Core behavior.

## 5. Stateful CoreSession

The canonical live Core is **stateful across batches**.

`CoreSession` owns transient algorithm state required for deterministic lifecycle processing, including route/group candidates, approved membership, stability/hysteresis timers, active event/alert state and the algorithm's current processed-time frontier.

It owns algorithm state only. It does **not** own database connections, Influx polling, React state, map rendering or persistent Workspace state.

### Core boundary
The historical Work Mode implementation is a **standalone Python Core**. The architecture must remain replaceable: application code talks through a stable language-neutral contract/adapter, so a future Core implementation can replace Python without changing UI or persisted product structures when the contract is compatible.

The current TypeScript Core package may implement the same contract for preview/testing, but architecture documents and persistence must not assume that the production Core is permanently TypeScript or in-process.

## 6. Core pipeline

Within CoreSession the algorithm stages remain logically separated:

1. normalized sample intake;
2. route-family/type estimation and canonical closed-route geometry;
3. cycle-time estimation and phase/progress;
4. geometry + period based membership candidate generation;
5. membership lifecycle/stability state machine;
6. synchronization, route and total score calculation;
7. alert/event state updates;
8. publishable Core frame/result.

Membership is structural and remains distinct from Score. A poor score alone does not split a group.

## 7. ClosedRoute / algorithm entities

The original `ClosedRoute` structure is retained as an architectural data object while later functional SRS determines the currently supported route families/types.

`ClosedRoute` contains at least:
- route/family identity;
- estimated geometry;
- canonical route representation (the validated DR allowed up to **64 canonical points**);
- center, axes and orientation;
- estimated period;
- logical regions such as leg/turn/connection when applicable.

The current route taxonomy, SO semantics and Template Builder behavior remain governed by the latest functional specification and are not reverted to older DR examples.

## 8. Membership lifecycle

The Work Mode state machine is preserved:

`Unassigned -> Candidate -> Assigned -> Suspected Exit -> Separated -> Candidate`

- Unassigned -> Candidate: structural geometry + period match is detected.
- Candidate -> Assigned: match persists through the confirmation/stability requirement.
- Assigned -> Suspected Exit: sustained structural change is detected.
- Suspected Exit -> Separated: change remains confirmed through the analysis window.
- Separated -> Candidate: a compatible route/group is detected again.

The validated DR records **120 seconds** for Candidate -> Assigned confirmation. This remains the Work Mode value unless explicitly changed through the conflict/decision matrix.

## 9. Alert lifecycle

Alerts are stateful and use persistence/hysteresis rather than a one-frame threshold test.

The validated Work Mode baseline records:
- score smoothing over **10 seconds**;
- `Score >= 80` normal;
- `50–80` intermediate / reason visible without audio;
- `Score < 50` for **10 seconds** -> audible alert;
- recovery requires **20 seconds** at `Score >= 60`;
- muting never removes the visual indication.

Newer UX requirements for Hebrew alert wording and user-selectable mute durations remain mandatory. Where recurrence/mute behavior conflicts, the conflict matrix is authoritative until the user selects the final policy.

## 10. Influx polling state machine

The Work Mode polling architecture is retained outside Core:

- **Awake server:** fetch all mapped metrics every **5 seconds**.
- **Dormant server:** lightweight Probe every **5 minutes**.
- **Return to dormant:** after **5 minutes without real vehicle identifiers**.

Polling state is an adapter/orchestrator concern; it is not Core algorithm state.

## 11. Checkpoints and recovery

Checkpointing is a first-class architectural concern associated with CoreSession and operational storage.

Recovered Work Mode/DR evidence establishes:
- CoreSession has deterministic lifecycle state and checkpoint support;
- checkpoints are persisted outside the Core process;
- checkpoint/replay behavior must preserve Batch/Increment determinism;
- checkpoints are operational state, not Workspace UI configuration.

The exact checkpoint save cadence and exact serialized-field list are **not recoverable from the retained validated artifacts**, so v1.6 intentionally does not invent those values. They appear in the conflict/decision matrix for explicit selection before implementation is declared final.

A restart implementation must not treat a WorkspaceState save as a Core checkpoint.

## 12. Persistence and storage ownership

The original architecture used **D1 / SQLite / Parquet + Checkpoint** and persisted GT, Config and Events. The current Workspace architecture is retained as an additional configuration/persistence surface rather than replacing the operational stores.

### Configuration / workspace persistence
- `WorkspaceState` remains the application configuration/state object.
- `/api/workspace` remains the central workspace save/load API.
- `workspaces` and `audit_entries` remain valid for workspace revision/audit persistence.
- localStorage may remain an offline fallback for WorkspaceState.

### Operational persistence — separate from WorkspaceState
Must support first-class persistence for:
- algorithm checkpoints;
- operational Events / event evidence and later revisions when implemented;
- GT scenarios/segments;
- Replay/simulator/validation artifacts;
- Parquet/cache data where used for large replay/history workloads;
- validation CSV/graphs/reports.

A Core replacement must not require a DB migration unless a persisted external contract changes.

## 13. Database backup / operational hardening

The earlier DR explicitly required **database backup/restore** as part of operational hardening, together with auth/permissions, audit, logs, service management, load testing and enterprise installation.

The retained Work Mode artifacts do **not** define backup cadence, retention count, media/location or RPO/RTO. Those parameters remain an explicit design decision and may not be invented by implementation code.

## 14. Workspace API / orchestration responsibilities

The Workspace/service layer owns:
- Bootstrap and Frame updates;
- loading normalized data/configuration;
- system state outside Core;
- persistence orchestration;
- event/config/GT access;
- CoreSession creation/restoration and batch delivery;
- publishing Core results to UI;
- adapter state such as Influx polling mode.

It must not reimplement route, grouping or scoring logic.

## 15. GT / Calibration / Validation

GT is persistent test/calibration truth and is never production Core input.

Canonical `GTScenario/GTSegment` content includes:
- scenario/segment id;
- server and start/end range;
- `geometry_json` / route geometry;
- groups / vehicle membership;
- synchronization rules/template reference;
- manual score/quality where used for calibration;
- status/edit metadata.

Validation flow remains:
`GT + recorded/simulated Raw NAV -> Replay through production Core -> Membership/Score -> compare with GT -> metrics -> CSV/graphs/report`.

Calibration remains:
`GT -> Sweep -> Replay -> Ranking -> Best configuration`.

The latest GT editor and route-bank UX remains governed by the current functional specification.

## 16. Simulator / Replay

The simulator provides deterministic navigation evidence, including timestamp, vehicle id, active state, positions and North/East velocities. It must support varied route/group transitions and failure/quality scenarios for end-to-end tests.

Simulator Ground Truth is stored separately and only compared after Core execution.

Historical simulation requirements introduced later (including at least 30 days and from/to slicing) remain mandatory and extend, rather than replace, this Work Mode architecture.

## 17. Deployment boundary

The validated architecture targets a connected **Windows server** first and **OpenShift** subsequently for the operational environment.

The public preview is not the production deployment model:
- it cannot be assumed to reach the closed Influx network;
- the historical public Worker did not run the Python Core;
- public/offline preview packages are validation/demo surfaces, not the source of production architecture truth.

Operational design must support the closed/offline environment and connected adapters.

## 18. Testing topology

### Core tests
Core tests are independent of UI and DB and must cover at least:
- normalized contract validation;
- deterministic processing;
- Batch vs Increment equivalence;
- route/period/membership/scoring behavior;
- state-machine transitions;
- checkpoint serialization/restore once the final checkpoint contract is selected;
- replay equivalence;
- no-data behavior;
- GT never entering production Core input.

### Integration tests
Integration tests cover:
- Influx normalization and 5s Join tolerance;
- polling/probe state machine;
- Workspace API orchestration;
- persistence of workspace/config, GT, events and checkpoints;
- Simulator/Replay -> Core -> UI/Investigation/PDF;
- DB backup/restore once the backup policy is selected.

### Validation tests
Use independent GT and compare the production result only after the Core has processed raw navigation.

## 19. Functional-spec preservation rule

This architecture does **not** restore obsolete UI or functional behavior from the older DR. In particular, the following remain controlled by the newest functional SRS:
- the current SO count-first Template Builder and symmetry de-duplication;
- current SO quarter/half placement and per-vehicle direction;
- current grouping law/threshold configuration;
- current Live map/group coloring/timeline behavior;
- navigation-derived scores and no fabricated operational values;
- estimated wind as explanatory evidence only;
- current Investigation/PDF event-map requirements;
- current GT engineering/real-map and measurement tools;
- current 30-day deterministic historical simulator and Influx no-fallback behavior.

Where a functional detail explicitly conflicts with an older Work Mode UX example, the newer functional requirement wins. Where an infrastructure/architecture detail conflicts, Work Mode wins unless the user explicitly selects another option in the conflict matrix.
