# Blue Wolf — SRS Normative Amendment v1.6 — Work Mode Architecture Restore

**Date:** 2026-09-06  
**Status:** Mandatory architecture amendment.  
**Precedence:** For architecture/infrastructure, v1.6 restores the original Work Mode / validated DR as the authority. For product functionality and UX, the newest functional requirement remains authoritative. v1.6 does not intentionally roll back the current Template Builder, Operator, Investigation, GT, simulation, map or score-truth requirements.

Supporting mandatory architecture document:
- `docs/BLUE_WOLF_ARCHITECTURE_V1_6_WORKMODE_CANONICAL.md`

## 71. Authority split
- **SRS-7101:** Architecture/infrastructure decisions shall follow the original Work Mode architecture unless explicitly re-decided by the user.
- **SRS-7102:** Current functional/UX requirements remain authoritative where they differ from historical UI/examples.
- **SRS-7103:** Architecture conflicts shall not be silently resolved by implementation convenience; unresolved choices shall be tracked in the conflict matrix.

## 72. End-to-end architecture
- **SRS-7201:** The processing topology is `InfluxDB2 / Replay / Simulator -> Ingest + Join -> CoreSession -> Storage/Checkpoint -> Workspace API -> UI/Investigation/Developer/Calibration`.
- **SRS-7202:** Ingest, Core, persistence, orchestration and UI remain separate responsibility boundaries.
- **SRS-7203:** The Core shall not query Influx directly, render UI/PDF or own database drivers.

## 73. Normalized navigation and Join
- **SRS-7301:** All sources normalize to one VehicleSample/NavigationDataset contract before Core processing.
- **SRS-7302:** The normalized evidence includes real vehicle id, UTC source time, WGS84 position including altitude, North/East source velocities, active state and reliability/quality where available.
- **SRS-7303:** Influx metrics arriving separately are joined outside Core with a hard **5-second temporal tolerance**, interpolation policy and reliability evidence.
- **SRS-7304:** No-data and query failure remain distinct; neither may silently substitute simulator data.

## 74. Logical time and Batch processing
- **SRS-7401:** Algorithm processing uses a **1-second logical time grid**.
- **SRS-7402:** Live navigation is delivered to a persistent CoreSession in **5-second batches**.
- **SRS-7403:** A Batch preserves the individual ordered time points/samples contained in the interval and is not a five-second average.
- **SRS-7404:** CoreSession remains stateful across batches and performs warm-up until sufficient evidence exists.
- **SRS-7405:** Incremental, normal Batch and Replay processing of the same evidence/configuration must be deterministic and equivalent at equivalent cutoffs within declared numeric tolerances.

## 75. CoreSession and replaceability
- **SRS-7501:** The live algorithm boundary is a stateful `CoreSession`, not only a stateless whole-window function.
- **SRS-7502:** CoreSession owns transient algorithm lifecycle state, candidates, approved membership, timers/hysteresis and active event/alert state; it does not own DB/network/UI state.
- **SRS-7503:** The original Work Mode production boundary is an independent **Python Core**. The application-to-Core contract shall be language-neutral so a future compatible Core can be replaced without changing UI or persisted product structures.
- **SRS-7504:** A TypeScript Core may implement the same contract for preview/testing/transition but shall not make the architecture permanently TypeScript-specific.
- **SRS-7505:** The Core contract shall support both stateful live Batch processing and historical Replay/analysis.

## 76. Core pipeline and data entities
- **SRS-7601:** Core stages remain logically separated: intake -> route/geometry -> period/phase -> membership -> scoring -> alert/event -> result.
- **SRS-7602:** Membership remains based on structural geometry + period and remains independent from score.
- **SRS-7603:** A `ClosedRoute`-style canonical route entity is retained, including geometry identity, center/axes/orientation, period, logical regions and canonical route representation; the current route taxonomy is controlled by the newest functional SRS.
- **SRS-7604:** The validated canonical representation may contain up to **64 canonical points**.

## 77. Membership lifecycle
- **SRS-7701:** Membership state machine is `Unassigned -> Candidate -> Assigned -> Suspected Exit -> Separated -> Candidate`.
- **SRS-7702:** Structural changes require persistence/stability before membership transitions.
- **SRS-7703:** The recovered validated Work Mode value for Candidate -> Assigned is **120 seconds**, pending any explicit user override recorded in the conflict matrix.

## 78. Alert lifecycle
- **SRS-7801:** Alerts are stateful and use smoothing, persistence and hysteresis rather than single-frame thresholds.
- **SRS-7802:** The recovered Work Mode baseline is 10-second smoothing; >=80 normal; 50–80 intermediate; <50 for 10 seconds audible; recovery after 20 seconds >=60.
- **SRS-7803:** Newer Hebrew wording and current user-selectable mute UX remain mandatory. Any conflict between older recurrence semantics and newer mute duration behavior remains an explicit matrix decision.

## 79. Influx polling state machine
- **SRS-7901:** Awake server polling runs every **5 seconds**.
- **SRS-7902:** Dormant servers receive a lightweight Probe every **5 minutes**.
- **SRS-7903:** A server returns to dormant after **5 minutes without real vehicle identifiers**.
- **SRS-7904:** Polling/probe state is outside Core.

## 80. Checkpoints and restart
- **SRS-8001:** CoreSession checkpointing is a first-class architecture requirement and is persisted outside the Core runtime.
- **SRS-8002:** Checkpoint state is distinct from WorkspaceState and from a general DB backup.
- **SRS-8003:** Restart/replay behavior must preserve deterministic Batch/Increment results.
- **SRS-8004:** The exact checkpoint cadence and serialized-field list are not asserted by this amendment because they were not recoverable from retained validated artifacts; implementation shall not invent them without an explicit matrix decision.

## 81. Persistence / storage
- **SRS-8101:** The original storage architecture `D1 / SQLite / Parquet + Checkpoint` remains part of the target architecture.
- **SRS-8102:** WorkspaceState `/api/workspace`, `workspaces` and `audit_entries` remain valid for configuration/workspace persistence but do not replace operational event/checkpoint/GT/replay stores.
- **SRS-8103:** Checkpoints, operational Events/evidence, GT scenarios/segments, Replay/cache artifacts and validation outputs shall be first-class persistence concerns outside Core.
- **SRS-8104:** Core replacement alone shall not require a DB migration unless an external persisted contract changes.

## 82. Database backup / operational hardening
- **SRS-8201:** Database backup/restore is mandatory operational-hardening scope together with auth/permissions, audit, logging, service management, load testing and enterprise installation.
- **SRS-8202:** Backup cadence, retention, storage target and RPO/RTO are not fixed by recovered Work Mode evidence and require an explicit user decision.

## 83. Workspace API / orchestrator
- **SRS-8301:** Workspace/service orchestration owns Bootstrap, Frame updates, source/config loading, system state, persistence, GT/event access, CoreSession creation/restoration, Batch delivery and publication to UI.
- **SRS-8302:** The orchestrator shall not duplicate route/grouping/scoring algorithms.

## 84. GT / Calibration / Validation
- **SRS-8401:** GT remains persistent and separate from production Core input.
- **SRS-8402:** GTScenario/GTSegment includes scenario/segment id, server/time range, geometry, groups/vehicles, synchronization rules/template reference, manual score/quality where used and status/edit metadata.
- **SRS-8403:** Validation path is `Raw NAV -> production Core -> Result`, followed by `Result <-> GT` comparison.
- **SRS-8404:** Calibration path remains `GT -> Sweep -> Replay -> Ranking -> Best`.

## 85. Deployment
- **SRS-8501:** Operational deployment targets a connected Windows server first and OpenShift subsequently, supporting closed/offline environments.
- **SRS-8502:** The public preview is not the production network/runtime architecture and must not be treated as proof that closed-network Influx or the production Python Core is deployed.

## 86. Test topology
- **SRS-8601:** Core tests remain independent of UI/DB and include Batch-vs-Increment determinism.
- **SRS-8602:** Once the checkpoint contract is finalized, Core tests shall include checkpoint/restore and replay equivalence.
- **SRS-8603:** Integration tests cover Join tolerance, Influx polling/probe state, Workspace orchestration, operational persistence and Simulator/Replay -> Core -> UI/Investigation/PDF.
- **SRS-8604:** DB backup/restore becomes executable release evidence after the backup policy is selected.
- **SRS-8605:** All v1.5 single-navigation-truth, GT separation, no-fallback and no-fabricated-operational-value tests remain mandatory.

## 87. Functional preservation
The following newer behavior is explicitly preserved and shall not be reverted by old Work Mode examples: current SO count-first builder, current SO slot/direction semantics, current group law thresholds, current map/timeline behavior, navigation-derived scoring, estimated wind as explanation only, current Investigation/PDF requirements, current GT tools, 30-day historical simulator, and Influx no-fallback behavior.
