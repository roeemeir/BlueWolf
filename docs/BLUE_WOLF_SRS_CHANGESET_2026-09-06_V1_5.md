# Blue Wolf — SRS Normative Amendment v1.5

**Date:** 2026-09-06  
**Status:** Mandatory newest amendment.  
**Precedence:** v1.5 overrides v1.4/v1.3/v1.2/v1.1/baseline wherever they conflict. All non-conflicting older requirements remain mandatory.

## 62. Replaceable Algorithm Core
- **SRS-6201:** The production algorithm implementation shall be isolated under `packages/bluewolf-core/` and shall expose a versioned stable API contract (`CORE_API_VERSION`).
- **SRS-6202:** Core input consists only of normalized navigation evidence plus an explicit immutable configuration snapshot. Core output consists only of algorithm-derived analysis/results.
- **SRS-6203:** The Core shall not import or call React, Next/Vite UI code, Drizzle/D1/database code, localStorage, browser globals, data-source network adapters or simulator Ground Truth.
- **SRS-6204:** The application shall access the Core through one application-to-core adapter. UI modules shall not contain duplicate production implementations of route/grouping/scoring/event algorithms.
- **SRS-6205:** A future Core may be replaced without DB/UI changes when the Core contract remains compatible. An incompatible contract requires an explicit `CORE_API_VERSION` change and adapter/contract-test update.
- **SRS-6206:** The existing SO grouping projection law is Core-owned. Legacy/UI imports may only re-export or call the Core implementation.

## 63. Persistence architecture remains outside Core
- **SRS-6301:** `WorkspaceState`, `/api/workspace`, Drizzle `workspaces` and `audit_entries`, revisions, audit records and localStorage fallback remain application/persistence concerns and shall not move into the Core.
- **SRS-6302:** Existing persisted structures and semantics for weights, thresholds, templates, active-template overrides, SO grouping thresholds, GT, route bank, map/Influx/server settings and investigation edits shall be preserved unless a later explicit requirement changes them.
- **SRS-6303:** Core replacement alone shall not require a DB migration.
- **SRS-6304:** Each application save continues to persist the complete WorkspaceState and an audit entry with category/action/detail through the existing workspace API.

## 64. Single source of operational truth — strengthened
- **SRS-6401:** Every operational numeric value shown in Operator, Investigation, PDF/report and system evidence must be directly measured from the selected NavigationDataset or derived by the Core from that dataset plus persisted configuration.
- **SRS-6402:** This applies to Sync score, Route score, Total score, component scores, route deviation, period, motion/progression error, group membership, current position, alert evidence, event boundaries/reasons, historical tables and report values.
- **SRS-6403:** Wind remains an estimate derived from navigation residuals. The simulator may inject known wind as GT for validation, but GT wind shall never be used to calculate production displayed wind or scores.
- **SRS-6404:** A displayed estimate shall be labelled as estimated and include confidence/quality where available.
- **SRS-6405:** Hard-coded operational demo numbers are prohibited in the active product path. When evidence is missing, UI displays `אין נתונים`/`—` and does not substitute another source or a synthetic value.
- **SRS-6406:** Visual-only values such as colors, layout coordinates, labels and spacing are exempt because they are presentation, not measured operational data.

## 65. Data-source symmetry
- **SRS-6501:** Simulation and Influx produce the same normalized `NavigationDataset` contract before entering the Core.
- **SRS-6502:** Influx mode must issue real mapped data queries. Health/Auth success alone is not considered data availability.
- **SRS-6503:** Influx query/normalization failure or an empty result shall not fall back to Simulation.
- **SRS-6504:** Source provenance includes sample count, vehicle count, source time range, latest sample, measured sampling interval, completeness/freshness when computable and warnings.

## 66. Historical simulation and investigation
- **SRS-6601:** The simulator provides at least 30 days of deterministic absolute-time navigation history.
- **SRS-6602:** Requesting a historical `from/to` range changes the actual raw samples analyzed; it is not a label-only filter.
- **SRS-6603:** Historical analysis, events, maps, vehicle tables, causes and PDF values are generated from the samples in the selected time range through the same Core used for live analysis.
- **SRS-6604:** Simulator scenarios across the historical period include varied joins, leaves/disconnections, period changes, route changes/deviations, route/group transitions and valid/invalid SO geometry so the system can be exercised end to end.

## 67. Ground Truth separation
- **SRS-6701:** Simulator GT is a test oracle only and is never input to the production Core.
- **SRS-6702:** GT may contain intended active vehicles, intended route/group membership, intended route kind and injected disturbance/wind.
- **SRS-6703:** End-to-end tests execute `Scenario → Raw NAV → Core → Result`, then compare Result to GT only after Core execution.

## 68. Core-only test suite
- **SRS-6801:** A dedicated Core workflow shall run independently of the full application build when Core files change.
- **SRS-6802:** Core tests cover deterministic output, contract version, no-data behavior, navigation-derived synchronization, SO projection grouping law, score bounds, event derivation and the absence of direct wind score injection.
- **SRS-6803:** Core tests enforce dependency purity: no UI, DB, browser, localStorage, network fetch or GT dependencies in Core source.
- **SRS-6804:** A Core-only development validation shall not require Playwright, application production build or DB migration when the public Core contract is unchanged.
- **SRS-6805:** A public release/preview still requires the complete integrated release gate, including the Core suite.

## 69. System Tests
- **SRS-6901:** In-app System Tests use the same production Core adapter as Operator/Investigation.
- **SRS-6902:** Tests use simulator-produced raw navigation and compare Core result to separate simulator GT.
- **SRS-6903:** System tests include the 30-day historical path, an Influx normalization fixture, no-data/no-fallback behavior and real stress runs through the production Core.
- **SRS-6904:** PASS/FAIL is generated by executable assertions and measured output; hard-coded PASS labels are prohibited.

## 70. v1.5 release gate
A build claiming v1.5 compliance must pass:
1. `npm run core:test` independently.
2. Core boundary/dependency purity checks.
3. Existing Python/reference tests where retained.
4. Application ESLint and TypeScript.
5. Production build and JS regression tests.
6. Browser QA covering NAV provenance, live score derivation, historical range loading, investigation/PDF event data and in-app System Tests.
7. Verification that active UI contains no fixed operational KPI values used as results.
8. Verification that Influx no-data does not show simulator results.
9. DB schema/save behavior remains compatible with the existing WorkspaceState/workspaces/audit architecture.
10. Protected public preview login, API and static assets are verified before a URL is delivered.
