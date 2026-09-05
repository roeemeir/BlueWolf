# Blue Wolf v0.8 — Acceptance Matrix

This file is the implementation gate for the rebuild. A feature is not marked **DONE** merely because a control or illustration exists. `DONE` means the behavior is implemented and has a deterministic verification path. `UI` means the workflow exists in the product surface but still needs the production backend/core connection. `INTEGRATION` means an external service/runtime is required.

## A. Algorithmic core and lifecycle

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| A1 | One canonical joined vehicle sample contract: time, lon, lat, alt, active, velocity N/E, reliability/provenance | DONE | Existing `VehicleSample` rejects invalid WGS84/reliability and carries field quality. |
| A2 | Invalid/inactive/missing samples do not bend route geometry | DONE | Existing detector filters inactive/missing/reliability-zero samples and transient bumps. |
| A3 | SI/SO route detection is based on geometry, not score | DONE | v0.8 classifier uses PCA/topology only. |
| A4 | SI compact route rule uses configurable symmetry ratio (default 1.5) | DONE | Core default remains 1.5; v0.8 descriptor exposes axis ratio. |
| A5 | Single hippodrome classification | DONE | Dedicated v0.8 regression test. |
| A6 | Double hippodrome classification | DONE | v0.8 uses a continuous dog-bone/waist topology, not two overlapping capsules. |
| A7 | Figure-eight classification | DONE | v0.8 checks self-intersection topology. |
| A8 | Route direction CW/CCW | DONE | Derived from signed area; self-crossing may be UNKNOWN. |
| A9 | Route period estimation/contract | DONE | Existing detector estimates from velocity/derived motion; v0.8 lifecycle receives explicit period. |
| A10 | Candidate after 60 s | DONE | v0.8 lifecycle regression. |
| A11 | Confirm new route after 300 s and at least a closed cycle | DONE | Existing detector enforces observation/cycle/closure; v0.8 lifecycle enforces timing state. |
| A12 | Confirmed-route history must be bounded | DONE | v0.8 rolling 600 s history; regression test ensures <=121 samples at 5 s cadence. |
| A13 | Geometry change threshold default 20% | DONE | v0.8 `material_change`. |
| A14 | Period change threshold default 20% | DONE | v0.8 `material_change`. |
| A15 | Change must remain stable 120 s before route revision | DONE | v0.8 lifecycle regression. |
| A16 | Route revisions are versioned, deterministic and do not silently replace history | DONE | v0.8 lifecycle emits candidate/revised with revision number. |
| A17 | Data loss at 20 s and membership hold/expiry at 300 s | DONE | Existing `CoreSession` regression. |
| A18 | Checkpoint restore deterministic | DONE | Existing checkpoint tests. |
| A19 | One-batch vs 5 s batches equivalent | DONE | Existing session tests. |
| A20 | Grouping uses geometry + period only, never sync score | DONE | v0.8 grouping ignores score arguments intentionally and tests this. |
| A21 | SI grouping: same center + same rotation + compatible period | DONE | v0.8 `si_group_compatible`. |
| A22 | SO grouping: endpoint adjacency + axis alignment + compatible period | DONE | v0.8 `so_group_compatible`. |
| A23 | Single/double SO may group with 2× period equivalence | DONE | v0.8 regression. |
| A24 | Closed SI group invalid when directions differ | DONE | v0.8 regression. |
| A25 | Group identity is preserved by stable membership, not by score | UI | Data model exists; full production grouping state machine still needs wiring into the public app. |
| A26 | Event = stable group identity interval | UI | UI/report model follows this; production event engine still needs core integration. |
| A27 | Alert != event | DONE/UI | Model and UI are separate; production alert state engine still needs runtime wiring. |

## B. Scoring

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| B1 | Per-vehicle Sync, Route and Total score | DONE | Existing deterministic scorer. |
| B2 | Group score is aggregation of valid vehicle scores, not a separate formula | DONE | Existing `aggregate_group_scores`. |
| B3 | Sync weights position/period/movement default 60/20/20 | DONE | Core config. |
| B4 | Route weights distance/tangent/curvature default 15/70/15 | DONE | Core config. |
| B5 | Total weights Sync/Route default 75/25 | DONE | Core config. |
| B6 | Flat → linear → zero error law | DONE | `score_error` regression. |
| B7 | SI position score uses angular error/ring law | DONE | Core scoring contract; template fitting supplies angular/cyclic error. |
| B8 | SI penalizes wrong direction and sustained self-spinning | PARTIAL | Wrong-direction zero gate exists; explicit self-spin detector from velocity/radius still needs runtime metric generation. |
| B9 | Prefer velocity perpendicular to SI radius | PARTIAL | Tangent component exists; production primitive metric generation still needs wiring. |
| B10 | SO position score uses cyclic phase and turn timing | PARTIAL | Scorer accepts cycle error; production near/far turn emphasis must be wired from route regions. |
| B11 | SO same/opposite/mixed semantics | DONE/UI | Template legality exists; runtime primitive metric generation still needs final integration. |
| B12 | Double SO quarter semantics: opposite quarters = opposite, adjacent = mixed | UI | Builder/preview contract present; production scoring adapter still required. |
| B13 | Double vs single equivalence uses two opposite singles | PARTIAL | Period/group equivalence implemented; final phase/scoring conversion still required. |
| B14 | Low-speed behavior drops tangent/curvature rather than fabricating values | DONE | Existing scorer. |
| B15 | Minimum reliability gate | DONE | Existing scorer. |
| B16 | Continuous score smoothing default 10 s | DONE/config | Core config and UI contract; runtime stream adapter still to wire. |
| B17 | Qualitative red/yellow/green thresholds | DONE/UI | Config + display. |
| B18 | Root-cause attribution based on weighted score loss | DONE | Existing scorer returns primary reason; retrospective supports multiple aggregate causes. |

## C. SO/SI templates

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| C1 | SI builder is sequential n−1 pair selection, not huge combinatorics | DONE/UI | 45/90/120 only. |
| C2 | SI builder allowed values only 45°, 90°, 120° | DONE/UI | Closed selector. |
| C3 | SI preview geometry moves when angles change and rings remain visible | DONE/UI | v0.5 base preview retained; v0.8 UI gate checks. |
| C4 | Live SI overlay shows all pairwise angles | DONE/UI | Live map contract. |
| C5 | SO requires at least 2 vehicles | DONE | v0.8 validation test. |
| C6 | Single hippodrome capacity max 2 | DONE | v0.8 validation test. |
| C7 | Double hippodrome capacity max 4 | DONE | v0.8 validation test. |
| C8 | Figure-eight capacity max 2 | DONE | v0.8 validation. |
| C9 | SO builder only offers route kinds with non-zero selected counts | DONE/UI | Layout generator contract. |
| C10 | Mixed only between adjacent entities where at least one is double | DONE | v0.8 validation test. |
| C11 | Mirror/symmetric duplicate SO layouts removed | DONE | canonical reverse key regression. |
| C12 | SO builder includes vehicle-type counts and entity order | UI | v0.8 rebuild surface. |
| C13 | SO preview shows positions and progression arrows | UI | v0.8 rebuild surface. |
| C14 | Template has no arena concept or arena filter | DONE/UI | Arena removed from template contract. |
| C15 | Default template may be selected per group | UI | Workspace data model; production persistence still to wire. |
| C16 | Template switch shows actual relation preview + expected score | UI | v0.8 rebuild gate. |
| C17 | Template switch can apply from now or from current event start | UI | Workspace contract and retrospective behavior. |
| C18 | Retrospective template change recalculates before save | UI | Required acceptance interaction. |

## D. Authoritative SO geometry

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| D1 | Hippodrome turns bulge outward; never inward | DONE/UI | Geometry primitive is a true stadium. |
| D2 | Double hippodrome is one continuous bent dog-bone/articulated closed route | DONE/core + UI | v0.8 topology generator/test; not two independent capsules. |
| D3 | Central waist/kink of double route is explicit | DONE/core + UI | Waist descriptor drives classification. |
| D4 | Side single hippodromes may have varied rotation/position | UI | Preview/route bank permits independent geometry. |
| D5 | SO chain is not forced into one symmetric smile | DONE/UI | Layouts are ordered entities, not a hardcoded smile. |
| D6 | Shared endpoints and neighbor axis relation are visible | DONE/core + UI | Grouping uses endpoint/axis checks; preview renders adjacency. |

## E. Live operator UX

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| E1 | Single operator screen with live map, continuous graph and alerts | DONE/UI | v0.5 base. |
| E2 | Waze-like directional arrows aligned with heading | DONE/UI | No bulky vehicle cards. |
| E3 | Smooth motion | UI | Animation contract; production cadence depends on live adapter. |
| E4 | Trace is discrete points every ~5 s, not black polyline | DONE/UI | Layer contract. |
| E5 | Optional score-colored trace + color scale | UI | Layer contract. |
| E6 | Route/path color is vehicle-type color | DONE/UI | Separate from group palette. |
| E7 | Group hull/polygon uses group color | DONE/UI | Separate palette. |
| E8 | Live template overlay can be toggled | DONE/UI | Map layer. |
| E9 | Live SO overlay uses simple same/opposite/mixed labels | DONE/UI | No verbose geometry text. |
| E10 | Layer toggles: trace/routes/groups/template/score trace | DONE/UI | Required map toolbar. |
| E11 | Map auto-fit | UI | Operator action. |
| E12 | Group display name composes saved route names when available | UI | Data adapter contract. |
| E13 | Timeline shows all groups simultaneously | DONE/UI | v0.5 base. |
| E14 | Total solid/prominent, Sync dashed, Route dotted | DONE/UI | Timeline contract. |
| E15 | 30/60/90/120 minute windows | DONE/UI | Closed segmented control. |
| E16 | Per-vehicle score available | UI | Inspector/report. |
| E17 | Alerts can be muted until restart or 5/15/30 min | UI | Required interaction. |
| E18 | Audible alerts | UI | Browser audio subject to user-gesture policy. |
| E19 | Global time slider affects all relevant screens | UI | Shared state contract. |
| E20 | Event list visible without mixing alert rows into events | DONE/UI | Separate entities. |

## F. Retrospective / reporting

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| F1 | Select time range | DONE/UI | Report filters. |
| F2 | Summary weighted score per group/event duration | DONE/UI | Duration-weighted formula. |
| F3 | Best event includes time range | DONE/UI | Card contract. |
| F4 | Show several dominant root causes when relevant | DONE/UI | Ranked cause list. |
| F5 | Summary map contains all events with stable colors | DONE/UI | Event overview map. |
| F6 | Summary map keeps routes in their real relative positions | UI | Route-bank coordinates reused; real map server integration required for geographic truth. |
| F7 | Event chapter: time, vehicles, total/sync/route, causes, start/stop reason | DONE/UI | Chapter contract. |
| F8 | Per-vehicle table has explicit column headers | DONE/UI | Regression requirement. |
| F9 | Group changes represented | UI | Report model. |
| F10 | Manual sync/template edit per event | UI | Interactive override. |
| F11 | Per-event arena selection is display metadata only | UI | No live coupling. |
| F12 | Retroactive template apply option | UI | Event-start application mode. |
| F13 | Navigation overlay optional | UI | Map layer. |
| F14 | PDF export produces a real document, not blank popup | UI | Must download/render a PDF artifact; browser print-only is not accepted as final. |

## G. GT, routes and calibration

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| G1 | GT scenarios persist and may contain multiple groups | UI | Workspace model; central backend integration pending. |
| G2 | Animated GT playback + time slider | DONE/UI | v0.5 base/rebuild. |
| G3 | GT clip start/end | UI | Required controls. |
| G4 | Select participants | UI | Required controls. |
| G5 | Separate subjective Sync and Route score | UI | Required controls. |
| G6 | Dedicated “route classified wrong” correction | UI | Required workflow. |
| G7 | Route correction supports direct draggable control points | UI | Not only move/scale/rotate. |
| G8 | Route bank: one saved route per record | DONE/UI | Data model. |
| G9 | One large map shows all filtered routes | UI | Route bank. |
| G10 | Edit/move/rename/vehicle type/arena metadata | UI | Route editor. |
| G11 | Calibration values use defined grids, no free numeric threshold | DONE/UI | Closed selectors. |
| G12 | Every threshold has tooltip/illustration usable on mobile tap | UI | Acceptance gate. |
| G13 | Parameter sweep/ranking/heatmap against GT | UI | Simulator/calibration surface; production GT backend pending. |

## H. Data, Influx, maps and persistence

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| H1 | InfluxDB 2 URL/org/token | UI | Settings form. |
| H2 | Explicit Bucket / Measurement / Key-or-Field per metric | DONE/UI | Mapping table. |
| H3 | As-Is and explicit value mapping | DONE/UI | Mapping contract. |
| H4 | Fill/interpolation policy | DONE/UI | Mapping contract. |
| H5 | Connection test | INTEGRATION | Must run from a network that can reach the actual Influx server. |
| H6 | Active polling target <=10 s end-to-end latency | PARTIAL | Core/UI target exists; production network benchmark still required. |
| H7 | Multiple servers | UI | Separate from arena. |
| H8 | Arena unrelated to Live; used for saved-route/report metadata | DONE/UI | Locked product rule. |
| H9 | WMS/WMTS/own map server | UI | Config surface; production map endpoint required. |
| H10 | Token auth for map source | UI | Config surface. |
| H11 | Day-long offline/cache mode | INTEGRATION | Requires service-worker/cache/storage packaging in final runtime. |
| H12 | Central shared config | INTEGRATION | Public preview can use local persistence; multi-user central store requires production backend. |
| H13 | Server-wide vs per-group settings are separated | UI | Configuration model. |
| H14 | Vehicle types can be renamed and have multiple ID ranges | UI | Settings model. |

## I. Simulator, system QA and UX quality

| # | Requirement | State | Acceptance rule |
|---|---|---|---|
| I1 | Simulator scenario: vehicle joins | DONE/test surface | Deterministic scenario. |
| I2 | Vehicle leaves | DONE/test surface | Deterministic scenario. |
| I3 | Cycle time changes | DONE/test surface | +22% scenario. |
| I4 | Whole group SO→SI | DONE/test surface | Deterministic scenario. |
| I5 | Disconnects/gaps | DONE/test surface | Deterministic scenario. |
| I6 | Load/latency scenario | UI/test | Browser/core benchmark + final network benchmark. |
| I7 | Tests grouped by route detection / grouping / sync / route / lifecycle / latency-load | DONE | Acceptance categories. |
| I8 | Edge cases, not only happy path | DONE/in progress | v0.8 tests include direction, endpoint, period, capacities, symmetry and lifecycle. |
| I9 | RTL Hebrew throughout | DONE/UI | Product shell. |
| I10 | Dark/light mode | DONE/UI | Theme support. |
| I11 | Apple-like modern design without putting glass over all content | DONE/UI | Glass reserved for navigation/control layer; content remains legible. |
| I12 | Mobile safe areas | DONE/UI | `env(safe-area-inset-*)`. |
| I13 | Touch controls ~44 pt and no clipped dialog buttons | DONE/UI | Responsive acceptance gate. |
| I14 | Conservative mobile density; map remains primary | UI | iPhone QA gate. |
| I15 | No fake “passed” status for demo-only features | PROCESS | UI must label integration/demo boundaries explicitly. |

## Release gate

A public test URL is acceptable only when:

1. Core self-tests are green, including v0.8 topology/lifecycle/SO legality.
2. No known unbounded route-history path remains in the runtime used by the preview.
3. SO visual geometry matches the continuous dog-bone interpretation above.
4. Desktop and narrow-mobile layouts are both manually checked for clipping/overflow.
5. Every row above is represented in the UI or explicitly labelled `PARTIAL` / `INTEGRATION` instead of being silently omitted.
6. The preview clearly distinguishes browser/demo data from production Influx/Python-worker integration.
7. Main branch is not overwritten until the preview is approved.
