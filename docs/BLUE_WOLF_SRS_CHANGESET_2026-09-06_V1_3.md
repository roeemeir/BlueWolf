# Blue Wolf — SRS Normative Amendment v1.3

**Date:** 2026-09-06  
**Status:** Mandatory newest amendment.  
**Precedence:** v1.3 overrides v1.2/v1.1/baseline wherever they conflict. All non-conflicting older requirements remain mandatory.

## 53. Wind is explanatory evidence, never a direct score input
- **SRS-5301 (OVERRIDES SRS-4903 where interpreted as a direct penalty):** Wind magnitude, direction, confidence or any wind-derived index shall never be multiplied into, subtracted from, or otherwise directly injected into Sync, Route or Total score.
- **SRS-5302:** In Simulation, injected wind may physically perturb the simulated navigation measurements. Any resulting score change is allowed only because the navigation evidence itself changed and the normal navigation scoring algorithm observed that change.
- **SRS-5303:** The operator may see an estimated wind contribution using a counterfactual comparison with otherwise equivalent no-wind navigation. The contribution must be labelled estimated/explanatory and explicitly state that it is not a score input.
- **SRS-5304:** Wind estimate remains magnitude in knots and bearing clockwise from geographic north, with confidence/quality.

## 54. Score provenance — navigation is the single source
- **SRS-5401:** Simulation must not provide hard-coded `observedAngles`, `observedRelations`, Sync scores, Route scores, period errors or motion errors to the operational scoring path.
- **SRS-5402:** Current and historical operational scores are derived from the same simulated navigation evidence used to render the vehicles/trails.
- **SRS-5403:** SI position score derives measured inter-vehicle angles from navigation position around the detected common center.
- **SRS-5404:** SO synchronization relation derives logical phase/quarter/half relationship from vehicle navigation projected onto the detected route, including Double normalization.
- **SRS-5405:** Period and motion evidence are estimated from phase/progression over time, with Double normalized to its two-Single-cycle equivalence.
- **SRS-5406:** Route evidence derives distance/tangent/geometry consistency from navigation relative to route geometry.
- **SRS-5407:** Timeline history invokes the same navigation scoring engine as the live card; a separate synthetic sine/cosine score generator is not an acceptable release implementation.

## 55. SO grouping geometry law
- **SRS-5501:** SO grouping is validated geometrically before vehicles/routes are admitted to one group.
- **SRS-5502:** Candidate neighboring hippodrome fronts must be approximately aligned. Default maximum axis/front difference is 20° and is configurable.
- **SRS-5503:** Proximity is evaluated by projecting the displacement between compatible/shared logical turn centers onto the mean hippodrome axis and its perpendicular axis.
- **SRS-5504:** Default maximum parallel separation is 1.5 mean Legs and is configurable.
- **SRS-5505:** Default maximum lateral/perpendicular separation is 0.35 mean Legs and is configurable. A large diagonal/Euclidean displacement cannot pass merely because total distance is below a scalar threshold.
- **SRS-5506:** Double is decomposed into two logical Single segments for grouping compatibility; its central joint is a logical shared-turn reference even though the physical Double removes the inner U-turn.
- **SRS-5507:** Vehicles whose routes fail the grouping law stay outside the group and do not contribute to that group score. Live UI identifies them as ungrouped and explains why.
- **SRS-5508:** Simulator Server 2 must include an intentionally non-compatible SO route which is excluded from the co-located group. Simulator Server 3 must demonstrate a geometrically valid Double+Single grouping under this law.

## 56. Operator interaction and Hebrew alerts
- **SRS-5601:** Template replacement is not a permanent page-level button. It is exposed only after the operator focuses/selects a group, within that group context.
- **SRS-5602:** Operator-facing alerts, reasons, event notes, grouping explanations and actionable status messages are detailed Hebrew. Generic English scenario strings are not acceptable.
- **SRS-5603:** Alerts state the affected group/vehicle, the observed evidence, threshold/confirmation status when known, and what the operator should infer. Alert remains distinct from confirmed Event.
- **SRS-5604:** Score-trail colorbar must visibly render the continuous score colors from low through medium to high; CSS must not erase/override the gradient.

## 57. Investigation and PDF refinement
- **SRS-5701:** Each per-Event PDF chapter map shows only that Event’s route geometry, vehicles/traces and evidence. Other Event/scenario routes are not drawn on that Event map.
- **SRS-5702:** The PDF summary map may continue to show all Events together.
- **SRS-5703:** Full vehicle table must not fabricate a per-vehicle Route score by jittering a group-level value. If real per-vehicle Route score is not explicitly calculated, the column is removed and replaced by direct evidence such as route deviation.
- **SRS-5704:** Per-vehicle Sync/Total values, when shown, derive from the same navigation engine and real per-vehicle/group evidence rather than row-index perturbations.
- **SRS-5705:** “גורמי שורש מרכזיים” uses explanatory Hebrew descriptions: what changed, affected vehicle(s), numeric evidence, persistence/threshold where applicable, and impact. Estimated wind contribution is explicitly marked estimated.

## 58. SO Template Builder v1.3 workflow
- **SRS-5801 (OVERRIDES manual route-chain construction in v1.2 UI):** Operator/developer first enters only the number of Single hippodromes and Double hippodromes.
- **SRS-5802:** Figure-8 remains synchronization-equivalent to Single and does not add another count dimension.
- **SRS-5803:** The builder generates all unique ordered Single/Double layouts automatically.
- **SRS-5804:** A layout and its exact left/right mirror are one equivalence class; only one representative is presented, eliminating symmetry redundancy.
- **SRS-5805:** After a layout is selected, the user places vehicles directly on two logical halves of each Single or four logical quarters of each Double.
- **SRS-5806:** Every placed vehicle exposes direction reversal and removal. Neighbor relations remain derived from placement+direction.
- **SRS-5807:** Existing canonical duplicate-template Save/Replace behavior remains mandatory and must also normalize mirror-equivalent layout identity.

## 59. Engineering map presentation
- **SRS-5901:** GT and Route Bank engineering map uses a clean orthogonal engineering grid. Pattern paths must have no polygon/triangle fill artifacts.
- **SRS-5902:** Grid lines are subtle and support route editing rather than visually competing with the route. Real configured base-map mode remains available where previously required.
- **SRS-5903:** Existing live angle and ruler behavior remains mandatory.

## 60. System Tests integrity
- **SRS-6001:** The in-app System Tests button executes production geometry/grouping/scoring/layout functions; it is not a list of hard-coded PASS labels.
- **SRS-6002:** At minimum executable tests cover: valid/invalid SO grouping projection law, Server 2 exclusion, Server 3 valid Double+Single, navigation-derived score range/provenance, wind-no-direct-penalty contract, mirror-deduplicated SO layouts, route geometry and persisted display defaults.
- **SRS-6003:** The 1,000-scenario stress action must actually invoke the navigation analyzer/grouping path and verify finite score/invariant results for each run.
- **SRS-6004:** In-app tests are additional evidence only. Release still requires independent Python Core, ESLint, TypeScript, production build, JS regression tests and Playwright browser QA.

## 61. v1.3 release gate
A build claiming v1.3 compliance must pass the complete older release gate plus:
1. No direct wind penalty/import path exists in operational scoring or timeline.
2. Live cards and timeline use the navigation-derived analyzer.
3. Server 2 exposes its incompatible route as ungrouped; Server 3 Double+Single passes executable grouping law.
4. Grouping settings 1.5 Leg parallel / 0.35 Leg lateral / 20° defaults are editable.
5. Template switch appears only in focused group context.
6. Score-trail colorbar visibly contains multiple colors in browser QA.
7. Operator alert content is detailed Hebrew.
8. SO builder count-first workflow generates mirror-deduplicated layouts and supports half/quarter placement plus direction.
9. Event PDF page draws only that Event.
10. Vehicle investigation table does not manufacture per-vehicle Route values.
11. GT and Route Bank engineering grids render without filled triangle artifacts.
12. System Tests execute production functions and a real 1,000-analysis stress loop.
13. Public protected preview is verified after all gates before a URL is delivered.
