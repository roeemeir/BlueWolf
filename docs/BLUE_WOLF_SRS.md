# Blue Wolf — System Requirements Specification (SRS)

**Status:** Authoritative baseline for every release after v0.8  
**Language/UI:** Hebrew RTL, English engineering terms where useful  
**Rule:** A release is not "complete" unless every mandatory requirement below is PASS, or explicitly classified as an external integration item with evidence and owner.

## 0. Release doctrine

- **SRS-0001** This document is the single product/engineering source of truth.
- **SRS-0002** No previously accepted capability may disappear in a later release without an explicit requirement change.
- **SRS-0003** A visual mock, hardcoded result, placeholder, fake simulator result, fake connectivity result, or static PDF preview must never be reported as implemented production behavior.
- **SRS-0004** Every release must produce a requirement matrix with `PASS / FAIL / INTEGRATION / DEMO` and evidence.
- **SRS-0005** `FAIL` blocks release. `DEMO` blocks any claim that the product is complete. `INTEGRATION` is allowed only for dependencies that genuinely require the target operational environment.
- **SRS-0006** Algorithmic correctness has higher release priority than visual polish.
- **SRS-0007** Group membership and synchronization quality are independent domains: **Groups = Geometry + Period; Score = Synchronization Quality; GT = Calibration Evidence**.
- **SRS-0008** Alert and Event are different domain entities. An alert never becomes an Event merely because its score crossed a threshold.
- **SRS-0009** Server/data-source selection and Arena are independent. Arena is metadata/display organization only and must not change Live grouping or algorithmic computation.

## 1. End-to-end architecture

- **SRS-0101** Supported data flow: `InfluxDB2 / Replay / Simulator -> Ingest & Join -> Core -> Workspace/Storage -> Operator / Investigation / Developer / GT / Calibration / Validation`.
- **SRS-0102** The algorithmic core must be independently testable from UI, map, HTTP, database, Influx, auth, reports and timezone formatting.
- **SRS-0103** Workspace state must support persistent Config, GT scenarios, route bank, templates, event metadata, manual overrides and checkpoints.
- **SRS-0104** Data adapters own querying, temporal join, interpolation, forward-fill and field provenance; the core consumes canonical joined samples.
- **SRS-0105** Core outputs must be deterministic for identical input, configuration, algorithm version and checkpoint.
- **SRS-0106** One-batch processing and equivalent fixed-size incremental batches must produce equivalent algorithmic results.
- **SRS-0107** Checkpoints must include schema version, algorithm version and configuration fingerprint and must reject incompatible restore.
- **SRS-0108** Historical corrections are handled by replay from a suitable checkpoint rather than silently mutating already-consumed samples.

## 2. Canonical navigation input

- **SRS-0201** Per sample: timestamp, server id, vehicle number, unique vehicle identifier, active state, latitude, longitude.
- **SRS-0202** Optional sample fields: altitude, velocity north, velocity east and field-quality/provenance.
- **SRS-0203** Nominal source cadence is approximately 1–2 s; the system must tolerate uneven cadence and missing samples.
- **SRS-0204** Temporal join target is 5 s logical tolerance/grid unless configuration explicitly changes it.
- **SRS-0205** Heading should use N/E velocity when sufficiently reliable; otherwise a robust trajectory derivative may be used.
- **SRS-0206** Interpolation/forward-fill must preserve provenance and lower reliability where appropriate.
- **SRS-0207** Impossible WGS84 coordinates, non-finite values and invalid identifiers must be rejected at the canonical boundary.
- **SRS-0208** Repeated overlapping query samples at or before the last processed timestamp must not be double-counted.
- **SRS-0209** No-data, resume and membership expiry timers must be explicit and deterministic.

## 3. Route families and route-state model

- **SRS-0301** Route family support: `SI`, `SO`, `FREE`.
- **SRS-0302** SO subtype support: single hippodrome, double hippodrome and figure-8; domain model also permits future double-figure-8.
- **SRS-0303** SI represents a compact closed route, typically circular/elliptical.
- **SRS-0304** Single SO is a stadium/hippodrome with two straights and outward semicircular turns.
- **SRS-0305** A hippodrome turn must bulge outward; it must not look like a stretched circle whose ends curve inward.
- **SRS-0306** Double SO is one continuous articulated/dog-bone/bent closed route with two lobes and a central waist/connection. It is not two separate overlapping capsules and not two independent hippodromes joined by a decorative line.
- **SRS-0307** The user-provided sketch with the central black double hippodrome is authoritative for Double SO topology and visual semantics.
- **SRS-0308** SO chains are not forced into a symmetric smile and are not forced to a fixed 30° between every adjacent entity.
- **SRS-0309** Figure-8 must be identified by self-crossing topology rather than merely by aspect ratio.
- **SRS-0310** Free route is used when closed-route evidence is insufficient or the vehicle structurally leaves its approved cyclic route.

## 4. Route detection

- **SRS-0401** Detection operates on a rolling observation window and rejects transient navigation spikes/outliers.
- **SRS-0402** Convert WGS84 samples to a stable local metric frame before geometric fitting.
- **SRS-0403** Estimate center, principal orientation, long/short axes, canonical geometry, route length, rotation direction, period, fit fraction and quality.
- **SRS-0404** Canonical closed route should be bounded to at most 64 points at the public core boundary.
- **SRS-0405** SI compactness baseline: long-axis/short-axis ratio up to 1.5, configurable through approved threshold values.
- **SRS-0406** Closed route must show sufficient traveled phase/cycles, closure and fit fraction before acceptance.
- **SRS-0407** Direction must be derived robustly as CW/CCW; unknown direction cannot satisfy same-rotation SI grouping.
- **SRS-0408** Period estimation should use reliable velocity when available, otherwise robust derived speed/time evidence.
- **SRS-0409** Period estimation must be robust to short holes and outliers.
- **SRS-0410** Candidate route may be emitted after at least 60 s of stable sufficient evidence.
- **SRS-0411** Initial route confirmation occurs only after at least 300 s stable evidence.
- **SRS-0412** Route history must be bounded. Confirmation must never cause unbounded append-only history growth.
- **SRS-0413** Confirmed routes remain re-evaluable. Material geometry or period changes can create a route revision candidate.
- **SRS-0414** Material route change baseline is 20% geometry or period change, using normalized geometry descriptors rather than score.
- **SRS-0415** A material route revision requires 120 s stable evidence before becoming the new confirmed revision.
- **SRS-0416** Revision candidate cancellation occurs when the observed route returns to the confirmed geometry before stability completes.
- **SRS-0417** Route revision must be checkpoint/replay deterministic.
- **SRS-0418** Diagnostics must expose sample count, effective inlier count, observation duration, axis ratio, fit tolerance, traveled distance, fit fraction, completed cycles and detection quality where available.

## 5. Group membership — global rules

- **SRS-0501** Group membership uses route geometry + period only. Synchronization score must not split, join or identify a group.
- **SRS-0502** A group requires at least 2 valid vehicles.
- **SRS-0503** Vehicle type and template legality affect scoring/template assignment but do not replace the geometry+period membership rule.
- **SRS-0504** Membership changes require stable evidence rather than reacting to a single frame.
- **SRS-0505** Baseline group membership confirmation window: 120 s.
- **SRS-0506** Short data gaps/disconnects use the configured membership-hold timer and must not immediately create event boundaries.
- **SRS-0507** Confirmed membership change creates an Event boundary only when the new membership becomes stable.
- **SRS-0508** Group identity should remain stable during temporary score degradation.
- **SRS-0509** Saved route names, when known, may compose the human-readable group name; they must not alter grouping mathematics.

## 6. SI grouping

- **SRS-0601** SI vehicles group only when their route centers are sufficiently close, their periods sufficiently similar and their rotation direction identical.
- **SRS-0602** Opposite CW/CCW SI routes must not be grouped together.
- **SRS-0603** SI geometry compatibility may tolerate natural radius/ellipse variation without splitting the group.
- **SRS-0604** SI grouping must not use the synchronization template angle or synchronization score as a membership condition.

## 7. SO grouping

- **SRS-0701** SO grouping uses geometric adjacency/connection, axis relationship and period compatibility.
- **SRS-0702** Single hippodromes intended to be related must share or lie near the appropriate end connection within tolerance.
- **SRS-0703** Axis alignment/relative orientation is part of SO geometry compatibility; no universal hardcoded 30° rule is allowed.
- **SRS-0704** A Double SO period is nominally twice a corresponding Single period.
- **SRS-0705** Double and Single may belong to the same SO group when geometry is connected and the 2× period relation is satisfied.
- **SRS-0706** Vehicles on the same Double are compared under Double semantics; a Double is not flattened into independent unrelated singles for membership.
- **SRS-0707** Double-vs-Single equivalence may model the Double as two opposed Single cycles for synchronization interpretation, while retaining one continuous Double geometry.

## 8. Group/Event lifecycle

- **SRS-0801** Event = a continuous interval in which group identity/membership and the applied synchronization configuration are stable.
- **SRS-0802** A score drop alone does not create a new Event.
- **SRS-0803** Alert open/close must not create Event open/close unless a structural/configuration event rule is independently met.
- **SRS-0804** Stable membership change closes the old Event and opens a new Event.
- **SRS-0805** Stable structural route-family/geometry change may close/open an Event according to the revised group identity.
- **SRS-0806** Template change may either apply from now, preserving a change marker, or retroactively from the current Event start and recalculate that Event.
- **SRS-0807** Event stores start/end, group identity, vehicles, template, route identity, scores, dominant causes and start/stop reason.

## 9. Synchronization templates — common

- **SRS-0901** Templates bind to vehicle types/route roles, not fixed vehicle IDs.
- **SRS-0902** Assignment searches legal slots and a free common phase so constellation rotation does not create artificial error.
- **SRS-0903** Duplicate slot identifiers are illegal.
- **SRS-0904** Free routes have no synchronization template.
- **SRS-0905** Template bank persists centrally in the target product and supports rename/edit/default assignment.
- **SRS-0906** Templates have no Arena field, no Arena filter and no Arena-dependent logic.

## 10. SI template rules

- **SRS-1001** SI builder uses direct sequential relative-angle selection, not a huge constellation-combination bank.
- **SRS-1002** For N vehicles, builder exposes N−1 sequential relations.
- **SRS-1003** Allowed builder angles are exactly 45°, 90° and 120°.
- **SRS-1004** SI preview geometry must actually move when an angle changes.
- **SRS-1005** SI preview keeps inner/middle/outer ring context visible.
- **SRS-1006** Live SI overlay shows all pairwise angles among current group members, not only builder-adjacent pairs.
- **SRS-1007** Circle scoring uses a ring/constellation law with free common rotation, not pair-specific absolute bearings.
- **SRS-1008** Equivalent rotated constellations are recognized as the same relative formation.

## 11. SO template rules

- **SRS-1101** SO builder starts from counts/occupancy by route entity type: Single, Double, Figure-8.
- **SRS-1102** SO requires at least 2 vehicles total.
- **SRS-1103** One Single hippodrome holds at most 2 vehicles.
- **SRS-1104** One Double hippodrome holds at most 4 vehicles.
- **SRS-1105** One Figure-8 holds at most 2 vehicles unless a future SRS revision explicitly changes capacity.
- **SRS-1106** Builder generates only layouts relevant to nonzero selected route types.
- **SRS-1107** If only Single is selected, Double layouts must not be offered.
- **SRS-1108** Impossible occupancy combinations must never generate a template.
- **SRS-1109** Mirror/symmetric duplicate SO templates are canonicalized and removed.
- **SRS-1110** Neighbor relations are `same`, `opposite`, `mixed`.
- **SRS-1111** `mixed` is legal only for an adjacent pair in which at least one entity is a Double hippodrome.
- **SRS-1112** Same/opposite for Single SO is defined primarily through progression/turn timing (near/far turn semantics), not a decorative arrow alone.
- **SRS-1113** Accordion behavior is a supported SO synchronization mode/interpretation.
- **SRS-1114** Double placement may use quarter semantics; opposite quarters imply opposite, adjacent placement may imply mixed.
- **SRS-1115** Empty quarter slots are legal.
- **SRS-1116** SO preview must show actual vehicle placement and direction/progression arrows.
- **SRS-1117** Live SO overlay should be visually simple: relation labels between relevant adjacent entities; do not clutter Live with unnecessary construction geometry.
- **SRS-1118** SO relation UI must not append a hardcoded `30°` label unless that angle is actually an independently stored selected parameter for that exact relation.

## 12. Scoring model

- **SRS-1201** Each valid vehicle receives `sync`, `route`, `total` and primary/dominant reason information.
- **SRS-1202** Group score is aggregated from valid vehicle scores only and requires at least two valid vehicles.
- **SRS-1203** Baseline total weighting: Sync 75%, Route 25%.
- **SRS-1204** Baseline Sync weighting: Position/Phase 60%, Period 20%, Movement 20%.
- **SRS-1205** Baseline Route weighting: Distance 15%, Tangent 70%, Curvature 15%.
- **SRS-1206** Component transfer function is `100 -> linear falloff -> 0` between approved full/zero thresholds.
- **SRS-1207** Missing tangent/curvature evidence at very low speed is excluded/reweighted, not automatically scored as a hard failure.
- **SRS-1208** Low reliability may invalidate the sample/vehicle for group score aggregation.
- **SRS-1209** FREE routes do not receive normal closed-route synchronization scoring.
- **SRS-1210** SI wrong-direction/self-spinning behavior must be penalized; velocity should be approximately tangent/perpendicular to radius when motion is reliable.
- **SRS-1211** SI position error is angular/constellation error around the shared center.
- **SRS-1212** SO position error is normalized cyclic phase/progression error.
- **SRS-1213** SO turn timing is retained as a diagnostic/causal measure; it is not introduced as an unapproved fourth top-level weight.
- **SRS-1214** Score cause attribution must identify the actual dominant loss contributors rather than a static canned phrase.
- **SRS-1215** Continuous score output is required per vehicle and per group over time.
- **SRS-1216** Qualitative display zones: good/warning/critical with configurable approved thresholds; baseline warning 80 and critical 50.

## 13. Operator UI

- **SRS-1301** Operator gets one coherent real-time operational screen: map, current groups, continuous scores and alerts.
- **SRS-1302** Live vehicle marker is a clean Waze-like directional arrow; it must align with heading.
- **SRS-1303** Live vehicle color represents group. Vehicle type is communicated by a small icon/shape, not by replacing the group color.
- **SRS-1304** Route/path color represents vehicle type.
- **SRS-1305** Group hull/polygon color represents group and uses a palette independent from vehicle-type colors.
- **SRS-1306** Map auto-fit should include all active relevant groups/vehicles.
- **SRS-1307** Map layer controls: trace dots, saved/current routes, group hulls, template relations, score-colored trace, navigation/map layer.
- **SRS-1308** Normal trace is discrete points approximately every 5 s; do not use a thick black historical polyline.
- **SRS-1309** Score trace colors the historical points by score and includes a clear color scale/legend.
- **SRS-1310** Vehicle selection opens per-vehicle total/sync/route/confidence/phase/reason details.
- **SRS-1311** Group card shows group total, sync, route, confidence, members, route/template and leading cause.
- **SRS-1312** If saved route names are known, group display name should include/compose them.
- **SRS-1313** Live Alert control supports mute until restart or 5/15/30 minutes.
- **SRS-1314** Muting audio does not hide visual alert state.
- **SRS-1315** Live arena selector must not exist as an algorithmic/filter control; Arena belongs to saved-route/report metadata workflows.

## 14. Timeline and graphs

- **SRS-1401** Timeline displays all active groups simultaneously using group colors.
- **SRS-1402** `total` = prominent solid line.
- **SRS-1403** `sync` = dashed line.
- **SRS-1404** `route` = dotted line.
- **SRS-1405** Legend must explicitly explain line style and group color.
- **SRS-1406** Time-window choices: 30 / 60 / 90 / 120 minutes.
- **SRS-1407** One global time slider drives all synchronized replay-capable views/screens.
- **SRS-1408** Event bands on graph represent Event intervals, not alert intervals.
- **SRS-1409** Graphs must preserve readable Y scale and must not visually flatten meaningful score variation.

## 15. Template switch workflow

- **SRS-1501** Template switch opens a preview of the selected relation/geometry, not generic placeholder art.
- **SRS-1502** Dialog displays expected `total`, `sync`, `route` before Apply using actual recalculation or an explicitly labeled deterministic estimate.
- **SRS-1503** Apply modes: `from now` and `from current Event start`.
- **SRS-1504** Retroactive Event-start apply recalculates Event scores before save.
- **SRS-1505** Dialog actions must remain visible, tappable and unclipped on iPhone/small screens.

## 16. Investigation / After Action Review

- **SRS-1601** User selects a time range and navigates Event segments.
- **SRS-1602** Investigation does not list every Alert as an Event.
- **SRS-1603** Summary shows weighted score per group, weighting Event score by Event duration.
- **SRS-1604** Best Event card includes Event time range.
- **SRS-1605** Root-cause summary shows multiple dominant causes when several materially contribute.
- **SRS-1606** Root causes show percentage of Event time and/or estimated score impact where available.
- **SRS-1607** Summary map shows all Events with stable colors and traces in their true relative map positions.
- **SRS-1608** Saved route geometry is shown where it actually resides on the map, not normalized to arbitrary card coordinates when real coordinates are available.
- **SRS-1609** Each Event chapter contains: start/end, duration, group, members, total/sync/route, per-vehicle scores, dominant causes, start reason and stop reason.
- **SRS-1610** Per-vehicle table has explicit column headers.
- **SRS-1611** Per-Event Arena may be selected/edited as metadata for reporting only.
- **SRS-1612** Manual template override immediately recalculates displayed results before Save.
- **SRS-1613** Investigation retains navigation overlay option.
- **SRS-1614** Group membership changes are visible as structural Event boundaries.

## 17. PDF report

- **SRS-1701** PDF export must actually generate/download a PDF, not open a blank popup/print placeholder that may fail silently.
- **SRS-1702** PDF uses a professional RTL layout with title, time range, summary KPIs, map, Event chapters, score graphs/tables and root causes.
- **SRS-1703** PDF content matches the currently applied retrospective overrides.
- **SRS-1704** PDF rendering must be tested for clipping, page breaks, Hebrew/English mixed text and mobile-triggered export.

## 18. Developer — GT

- **SRS-1801** Separate Developer workspace includes GT creation/calibration.
- **SRS-1802** GT creation: select server/data source, time range/clip, participants, groups, route name and optional Arena metadata.
- **SRS-1803** GT scenarios can contain multiple groups.
- **SRS-1804** GT is persistent across sessions in the target product.
- **SRS-1805** GT playback is animated and controlled by a time slider.
- **SRS-1806** GT supports trim start/end sliders.
- **SRS-1807** Subjective Sync score and subjective Route score are separate fields.
- **SRS-1808** Dedicated `route classified wrong` correction workflow exists.
- **SRS-1809** Route correction allows direct drag/edit of route geometry points, including move/resize/shape, not only coarse rotate/scale controls.
- **SRS-1810** Developer can visually compare algorithm output and GT over identical time positions.

## 19. Route bank

- **SRS-1901** One saved Route record represents exactly one route.
- **SRS-1902** One large map can display all routes matching current metadata filters.
- **SRS-1903** Route color is by vehicle type.
- **SRS-1904** Route can be selected, moved, renamed, reshaped, rotated/resized where useful and assigned Arena metadata.
- **SRS-1905** Route bank uses a proper engineering/map-server background, not an empty black canvas.
- **SRS-1906** Supports engineering profile, WMS, WMTS and own map source where configured.
- **SRS-1907** Saved route geometry stores real map coordinates when real data exists.

## 20. InfluxDB2 / data mapping

- **SRS-2001** InfluxDB2 connector supports URL, Organization, Token and polling configuration.
- **SRS-2002** Mapping is explicit per metric: Bucket, Measurement, Key/Field, value mode (`As-Is` / mapping), interpolation/fill behavior.
- **SRS-2003** Required metric mappings cover vehicle identifiers, active, lat, lon, altitude and velocity N/E.
- **SRS-2004** Support the operational source convention referenced as `ttag` where used by the actual deployment.
- **SRS-2005** Connection Test performs a real request; UI must not report success when only local schema validation occurred.
- **SRS-2006** Public preview must explicitly state when a closed-network Influx endpoint cannot be reached.
- **SRS-2007** Token values must never be exposed in logs or reports.

## 21. Map servers / offline

- **SRS-2101** Configure multiple map sources independently from data-source servers.
- **SRS-2102** Support WMS, WMTS and organization-owned map server URLs/tokens.
- **SRS-2103** Map source/profile can be selected for display without changing grouping/scoring.
- **SRS-2104** Target operational package supports day-long offline operation and map/data caching as defined by deployment policy.
- **SRS-2105** Offline package must document cache limits, expiry and behavior when upstream sources are unavailable.

## 22. Configuration

- **SRS-2201** Central configuration is shared in the target deployment.
- **SRS-2202** Clearly separate server-wide/system settings from per-group/template settings.
- **SRS-2203** Vehicle types can be renamed.
- **SRS-2204** Vehicle types may include multiple identifier ranges.
- **SRS-2205** Default template can be selected per relevant group/type policy.
- **SRS-2206** Maximum vehicles per group is configurable from approved options where applicable.
- **SRS-2207** Algorithm thresholds are selected from closed approved grids; production UI must not expose arbitrary free numeric inputs for locked parameters.

## 23. Calibration / Sweep

- **SRS-2301** Every algorithm threshold/parameter displayed in calibration has a concise operational explanation.
- **SRS-2302** Parameter explanation is accessible by click/tap on mobile as well as hover where available.
- **SRS-2303** Explanation includes a small illustration/curve when it materially aids understanding.
- **SRS-2304** Calibration executes parameter sweeps on the same stored GT scenarios.
- **SRS-2305** Output includes ranking, best configuration and heatmap.
- **SRS-2306** Validation pipeline: load GT/simulator records -> replay parameter set -> compute Membership and scores -> compare with GT -> produce metrics -> save graphs/CSV/report.
- **SRS-2307** Calibration never optimizes group Membership using synchronization score.

## 24. Simulator / validation suite

- **SRS-2401** Simulator is deterministic under a fixed seed.
- **SRS-2402** It generates raw-ish navigation behavior rather than only final hardcoded group scores.
- **SRS-2403** Mandatory scenarios: clean SI, clean SO Single, Double SO, Figure-8, vehicle joins, vehicle leaves, temporary disconnect/gaps, period change, geometry change, whole group SO→SI, spikes/outliers, low reliability, wrong direction/self-spin, template mismatch.
- **SRS-2404** Period-change regression includes at least a +22% case to cross the 20% material-change threshold.
- **SRS-2405** Load/latency suite stresses realistic vehicle/group counts and day-duration replay.
- **SRS-2406** System tests are organized by functionality: route detection, group assignment, synchronization score, route score, lifecycle/event segmentation, delay/gaps, latency/load, persistence/checkpoint, UI workflow.
- **SRS-2407** A UI button that merely waits and paints `PASS` is not a system test. PASS must come from executable validation evidence.
- **SRS-2408** Acceptance evidence includes automated tests plus browser workflow/visual tests.

## 25. Performance / reliability

- **SRS-2501** Server-to-operator update latency target is <10 s under approved load.
- **SRS-2502** Core scoring can update at 1 s logical cadence while UI map may render at a lower stable cadence (for example 2 s) without losing state correctness.
- **SRS-2503** Rolling histories, caches and retained Event data must be bounded/configured.
- **SRS-2504** One broken vehicle stream must not crash processing of unrelated streams.
- **SRS-2505** Determinism tests cover batching, checkpoint restore and query overlap.
- **SRS-2506** Algorithm output includes enough diagnostics for engineering root-cause analysis.

## 26. UX / visual design

- **SRS-2601** UI is Hebrew RTL throughout; mixed English engineering identifiers remain legible.
- **SRS-2602** Visual directionality follows RTL for navigation/progress controls unless an icon represents a real physical direction such as vehicle heading.
- **SRS-2603** Apple-like modern design is restrained: Liquid Glass primarily for navigation/controls as a functional layer, not indiscriminate blur over all content.
- **SRS-2604** Essential operational data remains visually dominant over decoration.
- **SRS-2605** Dark and light appearances are complete themes; switching theme must not leave major surfaces in the previous theme.
- **SRS-2606** Default mobile touch controls target at least 44x44 pt where practical and never below the platform minimum.
- **SRS-2607** Support safe-area insets on iPhone.
- **SRS-2608** No clipped modal footer/actions, overlapped buttons or horizontal overflow in primary workflows.
- **SRS-2609** Color is never the only carrier of critical status; use labels/icons/patterns where needed.
- **SRS-2610** Maps and charts have legends, readable contrast and accessible labels.
- **SRS-2611** Explanatory prose is concise and task-oriented; avoid verbose engineering paragraphs in the operator workflow.

## 27. Browser/device acceptance

- **SRS-2701** Required visual workflow QA: desktop wide viewport and iPhone-sized viewport.
- **SRS-2702** Required theme QA: light + dark.
- **SRS-2703** Required screens: Operator, Template switch, Investigation, PDF export, Templates SI/SO, GT, Route Bank, Influx mapping, Calibration, Simulator/System Tests, Settings.
- **SRS-2704** Browser console must be checked for uncaught errors/warnings affecting functionality.
- **SRS-2705** Hydration/static-asset failures are release blockers.
- **SRS-2706** Mobile dialog actions, sliders and map controls must remain reachable without precision tapping.

## 28. Security / deployment

- **SRS-2801** Deployment must not expose Influx tokens/map tokens/secrets in client bundles.
- **SRS-2802** Authentication method must not break CSS/JS asset loading on mobile browsers.
- **SRS-2803** Preview access control, if enabled, must preserve static assets and application hydration.
- **SRS-2804** Production and preview deployment state must be clearly distinguished.
- **SRS-2805** A deployment URL is shared for acceptance only after application health + assets + critical workflows are verified.

## 29. Release evidence required before link is called “validated”

1. Core unit/property tests all pass.
2. Route detection regression suite includes SI, Single SO, continuous Double SO, Figure-8, Free/partial, spikes and period/geometry changes.
3. Grouping tests prove score independence and SI/SO membership rules.
4. Template legality tests prove SI angles and all SO capacities/relations/de-dup rules.
5. Scoring tests prove transfer functions, weights, low-reliability behavior, direction/tangent behavior and valid-vehicle aggregation.
6. Lifecycle tests prove 60 s candidate, 300 s route confirm, 120 s material revision, bounded history, group confirmation, hold and Event boundaries.
7. Checkpoint/batching determinism tests pass.
8. TypeScript/type checks, lint and build pass for the actual product source.
9. Browser functional QA passes on wide desktop and iPhone viewport, light and dark.
10. Operator map/graphs, Template switch, Investigation/PDF, GT, Route Bank, Influx mapping, Calibration and Simulator workflows are explicitly exercised.
11. Every SRS requirement gets an evidence row. No unsupported claim is marked PASS.

## 30. External-integration items that cannot be faked in public preview

- Reachability/authentication against the actual closed InfluxDB2 network.
- Actual organization map-server/WMS/WMTS tokens and closed-network layers.
- Multi-user central persistence in the final deployment database/service.
- Operational authentication/authorization policy.
- Day-long offline field validation using the real packaging/deployment environment.

These stay `INTEGRATION` until tested in the target environment; UI simulation is not evidence of completion.
