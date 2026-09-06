# Blue Wolf — Architecture v1.5

**Date:** 2026-09-06  
**Status:** Current mandatory architecture.

## 1. Architectural objective
Blue Wolf is split so the algorithm implementation can be replaced independently of the UI, data-source adapters and persistence layer. A core-only development change can be validated by the Core contract/test workflow without building the full application. A release/preview still runs the complete integration gate.

## 2. Layer boundaries

### A. Navigation source adapters — outside Core
Responsibilities:
- Simulation: generate deterministic raw navigation samples for an absolute timestamp and historical range.
- InfluxDB 2: query mapped real navigation measurements and normalize them into the same raw navigation schema.
- Calculate source provenance only: sample count, vehicles, timestamps, sampling interval, completeness/freshness and warnings.

Output contract:
`NavigationDataset { samples: RawNavigationSample[], provenance }`

No adapter may provide precomputed Sync/Route/Total score, route classification, group assignment, event reason or wind explanation to the Core.

### B. Replaceable Algorithm Core
Location: `packages/bluewolf-core/`

Stable entry point: `packages/bluewolf-core/src/index.ts`  
Stable contract version: `CORE_API_VERSION`.

The Core owns:
- route estimation/classification from navigation samples;
- SI/SO geometric grouping law;
- synchronization measurements and scoring;
- route evidence and scoring;
- total score;
- period and progression estimates;
- navigation-residual wind estimate (explanatory only);
- alerts derived from measured evidence and configured thresholds;
- history-frame analysis;
- Event segmentation and boundary reasons.

The Core MUST NOT import or call:
- React/Next/Vite/UI code;
- Drizzle/D1/database code;
- localStorage;
- network/Influx fetch code;
- browser globals (`window`, `document`);
- simulator Ground Truth.

The Core receives immutable data/config snapshots and returns analysis values. It performs no persistence.

### C. Application-to-Core Adapter
Location: `lib/algorithm-core-adapter.ts`.

This is the single production boundary between the application and the algorithm package. It maps the existing Blue Wolf configuration/data structures into the stable Core contracts and maps Core output back to the application-facing types.

A future Core implementation may be swapped without changing UI/DB code if it preserves the contract and `CORE_API_VERSION` compatibility rules.

### D. UI / Operator / Investigation / Developer tools
Responsibilities:
- render Core output;
- select time ranges, templates and settings;
- show source provenance;
- create PDF/report views from Core Events/evidence;
- never invent numeric operational results.

UI-only presentation values (layout coordinates, colors, labels, visual spacing) are not operational data and are not persisted as measured results.

### E. Persistence / DB — outside Core and preserved
The existing persistence architecture remains authoritative:
- `WorkspaceState` is the saved application configuration/state structure.
- `/api/workspace` remains the central save/load boundary.
- Drizzle tables remain `workspaces` and `audit_entries`.
- `workspaces.state` stores the serialized WorkspaceState with a monotonic `revision`.
- every save writes an `audit_entries` row with category/action/detail.
- localStorage remains the offline fallback for the same WorkspaceState.

Core replacement does **not** require a DB migration as long as the application/Core adapter contract remains compatible.

Persisted examples remain outside Core:
- score weights and thresholds;
- templates and active-template overrides;
- SO grouping thresholds;
- GT records;
- map/Influx/server settings;
- route bank;
- UI/system settings;
- investigation edits.

Raw operational navigation is read from its data source for analysis; Core output is computed from that evidence and is not fabricated as workspace configuration.

## 3. Ground Truth boundary
Simulator GT is a separate test oracle. It may describe intended active vehicles, route membership, route kind and injected wind. GT is not passed to `analyzeNavigationDataset` and cannot influence production analysis.

System/Core tests follow:
`Scenario/Fixture → Raw NAV → Core → Result`  
then separately:
`Result ↔ GT`.

## 4. Testing topology

### Core-only gate
Workflow: `.github/workflows/algorithm-core.yml`.
Runs when `packages/bluewolf-core/**` changes.
Checks:
- isolated TypeScript contract;
- executable algorithm tests;
- deterministic output;
- route/group/score behavior;
- no-data behavior;
- event derivation;
- absence of UI/DB/network dependencies;
- no direct wind score input.

This workflow does not build the web UI and does not run browser QA.

### Full application/release gate
Required before a public preview/release:
- standalone Algorithm Core tests;
- Python/reference tests where retained;
- ESLint;
- TypeScript application typecheck;
- production build;
- JS regression tests;
- Playwright/browser QA;
- protected-preview login/API/assets verification.

## 5. Core replacement procedure
1. Keep the input/output contract compatible, or intentionally bump `CORE_API_VERSION`.
2. Replace only files under `packages/bluewolf-core/`.
3. Run the Core-only workflow.
4. If the public contract is unchanged, no UI or DB migration is required for development validation.
5. Before release, run the full integration/release workflow.
6. If the contract changes, update only `lib/algorithm-core-adapter.ts` plus the SRS/contract tests; DB migration is required only if persisted WorkspaceState itself changes.

## 6. Data truth rule
Operational values displayed by Blue Wolf must be one of:
1. directly measured navigation/source provenance;
2. a Core-derived result from those navigation samples and explicit persisted configuration;
3. an explicitly labelled estimate (e.g. estimated wind contribution/quality);
4. a visual-only presentation attribute.

Hard-coded demo operational numbers are prohibited in the active product path.
