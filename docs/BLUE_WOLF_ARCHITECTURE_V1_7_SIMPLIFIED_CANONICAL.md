# Blue Wolf — Canonical Architecture v1.7 — Simplified Work Mode

**Date:** 2026-09-06  
**Status:** Current mandatory architecture.  
**Decision source:** user-approved ADR v1.7 + restored Work Mode architecture.

## 1. Core principle
Keep only one source of truth for each concern:

- **InfluxDB:** real navigation history.
- **Ingest + Join:** reconstructible normalization layer.
- **Python CoreSession:** current canonical algorithm implementation.
- **Blue Wolf DB:** only data that cannot be reconstructed from Influx.
- **UI:** presentation and user actions, never algorithm duplication.

## 2. Runtime flow

`InfluxDB / Replay / Simulator -> Ingest + Join -> Python CoreSession -> UI`

Persistence runs beside the flow:

`Workspace/Config/GT/User Edits/Audit/Checkpoint -> Blue Wolf DB`

Automatic Scores/Events/analysis are computed products, not permanent sources of truth.

## 3. Ingest + Join

- No TTAG requirement.
- Select source/server from configured source settings.
- Join separately arriving fields by real vehicle identity + timestamp + field mapping/measurement context.
- Hard default temporal tolerance: 5 seconds.
- Preserve UTC source timestamps and reliability/field-quality evidence.
- Do not invent missing navigation values.
- No-data and integration failure are distinct and never fall back to Simulation.

The joined result is the only navigation contract accepted by Core.

## 4. Logical time and batching

- Core logical grid: 1 second.
- Live delivery: ordered Batch every 5 seconds.
- A Batch contains the individual time points; it is not an average.
- CoreSession remains alive across batches.
- Historical Investigation creates a fresh session and replays the selected historical range through the same Core.

Increment, Batch and Replay must be deterministic/equivalent at the same cutoff.

## 5. Current canonical Core

The current canonical implementation is **Python** under `core/src/bluewolf_core/`.

The external application contract remains language-neutral so a future replacement Core can use another implementation/language without changing UI or DB if the contract is compatible.

The TypeScript implementation under `packages/bluewolf-core/` is migration/reference compatibility code only and is not the canonical production algorithm.

## 6. CoreSession state

CoreSession owns only transient algorithm state needed across batches:
- route candidates and confirmed routes;
- group/membership candidates and confirmed membership;
- lifecycle/stability/hysteresis timers;
- active alert/event state;
- current processed-time frontier;
- config/schema/algorithm identity needed for deterministic recovery.

It does not own DB, Influx connections, HTTP, UI or raw-navigation history.

## 7. Checkpoint

- Save one CoreSession checkpoint every **5 minutes**.
- Checkpoint is a compact recovery snapshot, not a NAV archive and not a DB backup.
- On restart: restore checkpoint, query Influx from the processed frontier, Join, replay, then return to Live.

## 8. Membership lifecycle

`Unassigned -> Candidate -> Assigned -> Suspected Exit -> Separated -> Candidate`

- Analysis/stability uses a configurable working window in the 30–60 second range.
- Candidate -> Assigned requires 120 seconds sustained compatibility.
- Membership is structural (geometry + period + required direction rules), never score-driven.

## 9. Alerts

Alerts retain stateful smoothing/persistence/hysteresis. Threshold/timing numbers are configuration defaults, not hard-coded operational truth.

Mute options: 5/15/30 minutes or until restart. Mute affects audio only; visual indication/evidence/event remains.

## 10. Generic closed route

ClosedRoute is shape-agnostic. It can represent:
- circle;
- octagon/polygon;
- hippodrome;
- double route;
- arbitrary non-self-crossing closed path;
- other supported closed topologies.

The public contract contains a variable-length ordered canonical closed polyline plus optional recognized geometric descriptors and semantic regions.

Phase/progress is normalized arc length along the canonical closed path when radial center-angle phase is not appropriate. Therefore an octagon or irregular closed loop is handled naturally without pretending it is a circle.

Any internal resampling limit (for example 64 points) is an implementation/performance choice, not a public API restriction.

## 11. Current functional model

Newer functionality remains authoritative, including current route families/types, SO grouping law, count-first SO Template Builder, layout de-duplication, quarter/half placement, direction handling, Operator/Timeline, Investigation/PDF, GT, 30-day simulator, navigation-derived scores and explanatory wind estimate.

## 12. Influx polling

Defaults are configurable:
- awake server: every 5 seconds;
- dormant server: Probe every 5 minutes;
- return to dormant after 5 minutes without real vehicle identifiers.

When an operator opens/selects a server, it becomes **awake immediately** and is refreshed every 5 seconds; never wait for the dormant Probe interval.

## 13. UI refresh

UI may refresh/animate at 2-second cadence or smoother presentation cadence. Animation is presentation only and may not fabricate a new NAV sample, position, score or Core result.

## 14. Navigation/history retention

InfluxDB is authoritative historical NAV storage. Blue Wolf does not persist a second permanent Raw NAV copy and does not permanently persist Joined NAV by default.

Joined NAV may be kept in memory/temporary cache only for performance and may always be discarded/reconstructed.

If future Influx retention would delete required history, archival is a separate explicit feature decision.

## 15. What Blue Wolf persists

Persist only data not reconstructible from Influx:
- Workspace/configuration;
- thresholds/weights/templates and active selections;
- GT scenarios/segments;
- route bank and map/source settings;
- user investigation edits/overrides/notes;
- audit;
- five-minute CoreSession checkpoints.

Automatic historical score frames/events are not authoritative permanent records.

## 16. Historical analysis after Core replacement

The current canonical Core is used for future historical analysis too. When a better Core replaces the old one, Investigation reprocesses Influx history through the new Core.

Blue Wolf does not maintain a museum of old automatic Core results for reproducibility.

Exports/PDFs need not be retained by Blue Wolf after delivery unless a later retention requirement explicitly adds that behavior.

## 17. Backup

- daily backup of Blue Wolf-owned persistent DB data;
- snapshot before significant application version, DB schema or configuration migration.

Do not duplicate Influx NAV as part of application DB backup.

## 18. GT

GT remains separate from production Core input. Manual GT score/quality is allowed only for validation/calibration.

Validation path:
`Raw/Simulator NAV -> Join -> Python Core -> Result -> compare with independent GT`.

## 19. Core replacement gate

A replacement Core must pass independent tests for:
- contract/schema validation;
- deterministic Increment vs 5-second Batch;
- Live vs historical Replay equivalence;
- checkpoint/restore/replay equivalence;
- circular, octagonal/polygonal and non-circular closed-route behavior;
- route changes and joins/leaves/data gaps;
- membership lifecycle and 120-second confirmation;
- score/alert behavior;
- GT separation and no DB/UI/network dependency.

Core-only development validation does not require rerunning every UI feature when the external contract is unchanged. Public releases still require integrated QA.

## 20. Deployment

Operational target remains closed/offline-capable Windows server first and OpenShift subsequently. Public Cloudflare preview is a QA/demo surface and is not the production Python runtime architecture.
