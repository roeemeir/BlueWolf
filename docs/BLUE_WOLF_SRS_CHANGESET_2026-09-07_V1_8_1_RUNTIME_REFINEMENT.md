# Blue Wolf — SRS Runtime Refinement v1.8.1

**Date:** 2026-09-07  
**Status:** Normative refinement of SRS v1.8.  
**Applies together with:** the complete current SRS chain, especially v1.7 architecture and v1.8 functional/runtime amendment.

## 1. Purpose
This refinement records runtime behavior proven during the v1.8 integration cycle. It does not change the replaceable-Core boundary, the DB ownership model, the single-navigation-truth rule, or the public Core API. It makes current-state Live analysis, sparse sampling, local disturbance estimation, and integrated browser readiness explicit.

## 2. Selected Live window versus current operational fit
The Operator-selected Live navigation window and the current route/group fitting horizon are separate concepts.

The system SHALL retain the complete selected navigation window, currently supporting 30/60/90/120 minute Operator windows, for:
- raw navigation/map evidence;
- provenance and data-quality KPIs;
- bounded Timeline/history presentation;
- investigation hand-off and operator context.

The current operational route/group analysis SHALL use a bounded recent horizon rather than repeatedly fitting the entire selected display window. The current canonical horizon is **15 minutes**.

The 15-minute current-analysis horizon SHALL:
- contain enough evidence for multiple normal route periods and route fitting;
- prevent stale geometry from an earlier route phase from dominating the present operational picture;
- reduce warm-up computation without changing the authoritative loaded NAV dataset;
- preserve the complete selected-window provenance presented to the Operator;
- remain an internal algorithm/runtime parameter, not a fabricated data source.

Changing the current-analysis horizon in a future Core implementation is permitted when the public contract and SRS semantics are preserved and the independent Core gate proves equivalence/acceptance.

## 3. Streaming CoreSession reconstruction horizon
The streaming CoreSession state machine SHALL continue to process only the reconstructible recent route-history horizon during a fresh warm-up. With the current Core this retained route-history horizon is 600 seconds.

Therefore a normal Live warm-up may simultaneously have:
- 30–120 minutes of selected/display NAV;
- 15 minutes of current operational application analysis;
- 10 minutes of CoreSession route-history reconstruction.

These layers MUST NOT be conflated. Each exists for a different purpose and all originate from the same authoritative navigation dataset.

## 4. Sparse Live navigation evidence
A valid Live source may provide fewer than 20 route points during the configured early candidate interval, including at a 5-second sampling cadence.

When the route-topology classifier has insufficient points, the canonical streaming path SHALL treat the state as **insufficient evidence / route not yet confirmed**. It SHALL NOT:
- throw a transport-visible application error merely because the evidence window is still filling;
- invent a route;
- lower the topology classifier's evidence requirement silently;
- substitute simulator or TypeScript analysis.

Only the specific insufficient-point condition may be converted to a no-result state. Other route-detection validation errors SHALL remain errors.

## 5. Local disturbance/wind vector estimation
The displayed wind/disturbance estimate remains explanatory NAV-derived evidence and SHALL NOT be a direct score input.

For non-circular routes, expected instantaneous route velocity SHALL be learned locally from the same directed route branch. The canonical estimator SHALL:
- select the current local route branch/tangent from historical Raw NAV;
- use measured heading to disambiguate nearby competing branches when necessary;
- learn nominal motion speed from historical samples travelling on that same local directed leg, rather than from a whole-route speed average;
- subtract the resulting local expected velocity vector from the current measured navigation velocity;
- expose the residual magnitude/bearing as the disturbance estimate;
- remain independent of simulator injected-wind GT.

A small physical disturbance SHALL not be rotated into an unrelated bearing merely because different route legs have different nominal speeds or headings.

## 6. Double SO grouping evidence
The v1.9 articulated-Double grouping refinement remains normative under v1.8.1:
- Double arms are learned from Raw NAV motion/geometry;
- pairwise grouping compares learned arms using the normal SO external-neighbor law;
- a fixed synthetic bend is not operational truth;
- GT remains outside production grouping.

This behavior does not introduce a new SO family or route type beyond the already approved Single/Double/Figure-8 semantics.

## 7. Browser/runtime readiness
An integrated browser test SHALL NOT treat the Operator page as operationally ready merely because the React shell or map container rendered.

For tests or release validation that subsequently navigate to another screen, readiness SHALL include receipt of a usable Python Core result for the current Live dataset, or an explicit no-data/unavailable result where that is the expected scenario.

This prevents abandoned expensive warm-up requests from being mistaken for successful application state and reduces false contention between sequential end-to-end tests.

The release gate SHALL still fail on a genuine Core timeout or unavailable state when Live analysis is expected.

## 8. Required automated evidence
The independent Python Core suite SHALL include executable evidence for:
- a 30-minute selected Live dataset retaining full provenance while current analysis is bounded to 15 minutes;
- sparse 5-second navigation not crashing route lifecycle before enough topology points exist;
- a small known local velocity disturbance recovering both reasonable magnitude and bearing without simulator GT;
- no regression in checkpoint/replay, Figure-8, SI grouping, Double+Single SO grouping, scoring, or route lifecycle.

The integrated release gate SHALL additionally prove:
- Live Operator returns a detected group from production Python Core when the deterministic scenario contains one;
- sequential Browser QA waits for Core readiness before navigating away from Live;
- System Tests execute production Core before external GT comparison;
- no simulator or TypeScript algorithm fallback occurs on Core failure;
- public preview is not declared verified until the exact release commit passes authenticated public URL, Python Core proxy, workspace API and asset checks.

## 9. Persistence and replacement boundary
No DB migration is introduced by this refinement.

The DB continues to store non-reconstructible product state and compact checkpoints outside the algorithm implementation. Raw navigation remains authoritative/reconstructible from its source, and the replaceable algorithm boundary remains:

`Normalized NAV + immutable configuration/state contract -> Python Core -> derived analysis`

A future Core may replace the Python implementation without UI/DB redesign when the public contract remains compatible and both the independent Core gate and integrated release gate pass.
