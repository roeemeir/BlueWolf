# Blue Wolf — SRS Normative Amendment v1.4

**Date:** 2026-09-06  
**Status:** Mandatory newest amendment.  
**Precedence:** v1.4 overrides v1.3/v1.2/v1.1/baseline wherever they conflict. All non-conflicting older requirements remain mandatory.

## 62. One navigation truth source
- **SRS-6201:** No operational, investigation, PDF or test result may display a numeric value that is merely a demo constant, row-index jitter, hand-authored scenario score or decorative placeholder while presented as measured/derived data.
- **SRS-6202:** Every displayed Sync, Route and Total score is derived from navigation samples through the production analysis path.
- **SRS-6203:** Every displayed wind estimate is derived from navigation velocity/path residual evidence. Simulator wind truth may be used only as GT in tests and must not be shown as the estimate.
- **SRS-6204:** Alerts, reasons and event boundaries are derived from changes/evidence in navigation analysis (membership, route geometry, cycle period, motion, data gaps, route deviation, group transition). Scenario-authored text is not an operational alert source.
- **SRS-6205:** Data-quality, freshness/latency and sampling KPIs, if displayed, are calculated from timestamps, gaps and sample counts. Otherwise they are omitted.
- **SRS-6206:** Configuration values and thresholds may be displayed as configuration, but must be visually/textually distinguishable from measured data.
- **SRS-6207:** Every analysis result carries provenance identifying `simulation` or `influx`, source time range, latest sample timestamp, sample count and vehicle count.

## 63. Simulator as raw navigation producer
- **SRS-6301:** The simulator produces timestamped raw navigation samples (vehicle id, active, latitude/longitude or equivalent local position, altitude where relevant, velocity north/east and sample time). Product metrics are computed downstream from those samples.
- **SRS-6302:** Simulator GT may include route/family/event/wind truth solely for automated comparison; GT fields are not inputs to the displayed score/alerts/report.
- **SRS-6303:** The deterministic simulator supports at least 30 days of historical data addressable by absolute timestamp.
- **SRS-6304:** Historical simulation contains diverse deterministic changes: joins, leaves, temporary data loss, cycle-period changes, route deviations, geometry revisions, valid/invalid SO grouping, Single/Double changes and SO↔SI transitions.
- **SRS-6305:** Requesting the same server and absolute time range produces the same navigation and GT, enabling reproducible investigation and regression tests.

## 64. Influx is a real source, never a simulator fallback
- **SRS-6401:** In Influx mode, the application queries the configured InfluxDB 2 source for the requested server/time range and normalizes the configured mappings into raw navigation samples.
- **SRS-6402:** If Influx is unavailable, authentication fails, mappings are insufficient or no samples exist, operational score fields show an explicit unavailable/no-data state. They must never silently fall back to simulator values.
- **SRS-6403:** The same production navigation analysis used for simulation consumes normalized Influx samples for scores, route/group evidence, wind estimate, alerts and investigation.
- **SRS-6404:** Influx response diagnostics include source URL host, requested time range, normalized sample count, vehicle count, newest sample time and mapping/join warnings without exposing the token.

## 65. Historical investigation is data-window driven
- **SRS-6501:** Investigation `from/to` controls actually request/analyze that range. Fixed hard-coded Event times are prohibited.
- **SRS-6502:** Simulation investigation supports any slice within the available 30-day history; Influx investigation queries the same selected range from Influx.
- **SRS-6503:** Event segmentation is generated from navigation-derived state transitions. Every Event stores the evidence that opened/closed it.
- **SRS-6504:** Summary KPIs, vehicle tables, root causes, maps and PDF pages are computed from the selected source/range and the resulting Event analyses.
- **SRS-6505:** Every per-Event PDF map contains only samples/routes belonging to that Event. Summary may contain all Events.

## 66. Real end-to-end System Tests with simulator GT
- **SRS-6601:** In-app System Tests execute the production simulator → raw samples → production analyzer → grouping/scoring/event path.
- **SRS-6602:** Tests compare production output against simulator GT for known scenarios; GT is an oracle only and is never supplied to the analyzer.
- **SRS-6603:** Tests cover at least route-family detection, valid/invalid SO grouping, membership join/leave, cycle-period change, route change/transition, data gap behavior, score finiteness/range, wind-estimate direction/magnitude tolerance, event boundary detection and month-history slicing.
- **SRS-6604:** A provenance test asserts that displayed score fields cannot be populated when source samples are missing.
- **SRS-6605:** An Influx adapter contract test uses fixture CSV/series data through the same normalization layer and verifies there is no simulation fallback.
- **SRS-6606:** System Tests report the actual number of production analyses executed and failures with evidence, rather than decorative PASS labels.

## 67. v1.4 release gate
A build claiming v1.4 compliance must pass all older non-conflicting gates plus:
1. No hard-coded operational reliability/latency/score/alert metric remains in the active v1.4 UI.
2. Simulation metrics carry navigation provenance and are derived from raw navigation samples.
3. Influx mode performs a real query or displays explicit no-data/error; no simulator fallback exists.
4. Wind shown to the operator is a navigation residual estimate, not simulator wind truth.
5. Investigation `from/to` changes the analyzed simulation/Influx window and Events/PDF accordingly.
6. A deterministic 30-day simulation history is queryable.
7. System Tests exercise production data flow against separate GT and include month slicing and Influx normalization contract tests.
8. JS/TypeScript/ESLint/build/Python Core/Playwright and protected public preview verification all pass before a URL is delivered.
