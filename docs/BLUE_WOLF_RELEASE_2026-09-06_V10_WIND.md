# Blue Wolf v0.10 — SRS v1.2 Wind Release Candidate

**Date:** 2026-09-06  
**Branch:** `bluewolf-v07-clean`  
**Status:** Protected-preview release candidate

## Scope closed in this candidate

This release candidate closes the remaining end-to-end wind-disturbance gap in SRS v1.2:

- deterministic steady and gust wind injection exists in the Python core simulator;
- injected disturbance changes generated navigation position and measured velocity;
- vehicles may have different deterministic wind-response gains, producing measurable synchronization geometry degradation;
- Live map positions, normal trails and score-colored trails reflect the active simulation wind mode;
- SI live relation measurements use the disturbed current positions;
- the shared timeline propagates the historical wind penalty into Sync and Total scores;
- the operator wind selector (`off`, `steady`, `gusty`, `crosswind`) drives map, timeline and score behavior in Simulation mode;
- Influx mode does not inject synthetic wind;
- per-vehicle estimated wind/disturbance remains exposed in knots and bearing from geographic north with confidence indication.

## Regression protection

The executable v1.2 gate now verifies both source contracts and runtime behavior. Browser QA explicitly switches wind modes and confirms that the operational map/timeline react. Python core tests verify deterministic gust behavior and measurable synchronization-geometry impact.

The repository CI browser gate has also been promoted from the obsolete v0.9 SO-builder acceptance suite to the current v0.10/SRS v1.2 acceptance suite, so removed legacy `+/-` SO controls are no longer treated as required product behavior.

## Verification state before protected preview

The parent release candidate passed Python Core, ESLint, TypeScript, production build, JavaScript regression/asset tests and Browser QA v0.10. The protected-preview workflow must independently repeat the release gates and verify public login, authenticated application, Workspace API and assets before its generated URL is treated as verified.
