# Blue Wolf — SRS Normative Amendment v1.1

**Date:** 2026-09-06  
**Status:** Mandatory, normative amendment to `docs/BLUE_WOLF_SRS.md`  
**Precedence:** If this amendment conflicts with an older requirement, this amendment wins. All non-conflicting requirements in the baseline SRS remain mandatory.

## 27. Geometry, map semantics and visual truth

- **SRS-2701** Every Single SO hippodrome, everywhere in the product (Live, Template Preview, GT, Route Bank, Investigation, PDF and test fixtures), must be a mathematically normal stadium: two parallel straight legs connected by two smooth outward semicircular turns.
- **SRS-2702** A hippodrome must never contain an inward hook, inward U-turn, pinched end, concave turn, or a curve that visually folds back toward the center at the outer end.
- **SRS-2703** `legLength = 0` is the canonical circle/compact special case. A positive leg length produces a hippodrome. The same semantic geometry editor shall therefore support circle and hippodrome.
- **SRS-2704** Double SO remains one continuous articulated closed route. It may be constructed from two user-edited hippodromes by selecting exactly two source routes and connecting them; the resulting Double removes the two internal turnarounds and retains only the two outer turnaround ends with a smooth central articulation.
- **SRS-2705** Double SO editing must expose both leg lengths and the relative bend/connection geometry in addition to center/radius/orientation.
- **SRS-2706** Figure-8 conversion shall be available from the parametric route editor and produces a self-crossing route, not merely a label change.
- **SRS-2707** Geometry regression tests must explicitly reject inward-hook hippodromes and verify outward extents, continuity and closure.

## 28. Vehicle, route and group colors

- **SRS-2801 (OVERRIDES SRS-1303)** Vehicle marker/arrow/icon color in Live, GT, Template Preview and other operational maps is always the vehicle-type color. Group color is represented by the enclosing hull/polygon, group labels and graph series.
- **SRS-2802** The first three vehicle-type palette entries are fixed for the current operational product: **Type A = orange**, **Type B = blue**, **Type C = purple**. Rename of a vehicle type does not change its palette slot unless a future SRS explicitly changes this rule.
- **SRS-2803** Saved/current route color always follows the vehicle type assigned to that route.
- **SRS-2804** Group palette is independent from vehicle-type palette and is used for hulls/polygons, event/group identification and graph series.

## 29. Base map versus overlays

- **SRS-2901 (AMENDS SRS-1307)** Base-map selection is a separate display control. Engineering map / WMS / WMTS / XYZ / orthophoto choices are not overlay toggles.
- **SRS-2902** Overlay controls on Live are limited to analytical drawings placed over the selected base map: normal trace, routes, group hulls, template relations and score-colored trace (plus future analytical overlays explicitly added by the SRS).
- **SRS-2903** Changing the base map must never alter grouping, scoring, template assignment or Event lifecycle.

## 30. Traces and score trace

- **SRS-3001** Normal traces must be visually legible at normal mobile zoom. Approximate 5-second trace points use sufficient radius/opacity/contrast to remain visible over engineering and photographic backgrounds.
- **SRS-3002** Score-colored trace is a distinct layer and colors each historical point according to the score at that time.
- **SRS-3003** Score-trace legend is mandatory and explains at least good/warning/critical bands.
- **SRS-3004** Enabling score trace must not silently replace the normal trace unless the user disables the normal trace explicitly.

## 31. Template builder interaction and SO permutations

- **SRS-3101** Vehicle counts in SI and SO Template Builders use explicit `+` and `−` stepper controls adjacent to each vehicle type. Count sliders are not used.
- **SRS-3102** SO layout permutations are generated/recomputed immediately whenever any count changes; no separate “Generate” action is required.
- **SRS-3103** In the SO builder, a permutation means the ordered sequence of route entities/hippodromes, including their route subtype and bound vehicle type.
- **SRS-3104** Two different vehicle types may **never occupy the same physical route entity/hippodrome**. The layout packer must create distinct entities for different types even if they are spatially co-located.
- **SRS-3105** A legal SO permutation may include two distinct Single hippodromes with the same center for different vehicle types. Co-location means separate route geometries with a shared center; it does not mean shared occupancy of one route record.
- **SRS-3106** Co-located route permutations must be visibly distinguishable in Preview, for example by different radii/line colors and an explicit “shared center” indication.
- **SRS-3107** After selecting a permutation, the user selects synchronization relation independently for every adjacent entity pair.
- **SRS-3108** Changing any adjacent relation immediately changes vehicle placement/progression in Preview so `same`, `opposite` and legal `mixed` relations are visually distinguishable.
- **SRS-3109** `mixed` remains legal only for an adjacent pair containing a Double route.
- **SRS-3110** Template Preview uses vehicle-type colors for route and vehicle markers.

## 32. Synchronization score sensitivity

- **SRS-3201** SI angular-template mismatch must materially affect Sync score according to the approved `100 -> linear -> 0` position transfer function and current thresholds.
- **SRS-3202** With the baseline SI position band 10° full / 30° zero and Sync weights 60/20/20, a 30° angular mismatch with otherwise perfect Period and Movement shall drive the Position component to 0 and therefore cap Sync near 40, not remain near the original score.
- **SRS-3203** Operator Template Switch and Investigation Template Override must use the same deterministic sensitivity law as the Core contract, or explicitly invoke the Core; a weak ad-hoc estimator is not allowed.
- **SRS-3204** Release tests must contain monotonic angle-sensitivity evidence: perfect template > moderate mismatch > threshold-crossing mismatch, with a material score separation.

## 33. Timeline behavior

- **SRS-3301** Choosing 30/60/90/120 minutes changes the actual data slice and x-axis bounds, not only the labels.
- **SRS-3302** Both active groups remain visible simultaneously regardless of which group card is selected.
- **SRS-3303** Group identity uses group color; metric identity uses line style: Total solid/prominent, Sync dashed, Route dotted.
- **SRS-3304** Timeline contains an explicit group-color legend and metric-line-style legend.
- **SRS-3305** User can independently hide/show Total, Sync and Route series. At least one metric remains visible.

## 34. Template switch mobile accessibility

- **SRS-3401** Template switch must never clip its Apply action on iPhone/small screens.
- **SRS-3402** Modal/sheet uses a bounded scrollable content region and a footer that remains reachable/visible above the device safe area.
- **SRS-3403** Expected Total/Sync/Route/Position is recalculated whenever the candidate Template changes.

## 35. Investigation and PDF

- **SRS-3501** Event start/stop explanation explicitly includes vehicle identifiers that joined and/or left when membership change caused the boundary.
- **SRS-3502** PDF summary page contains an actual map rendering, not only textual KPIs.
- **SRS-3503** Every Event chapter/page in PDF contains an Event map with route geometry and historical trace evidence relevant to that Event.
- **SRS-3504** PDF maps use route vehicle-type colors and Event/group colors consistently with the application.
- **SRS-3505** PDF regression QA must verify that map pixels/content exist on summary and Event pages and are not blank placeholders.

## 36. Threshold help illustrations

- **SRS-3601** Every exposed threshold keeps the concise explanation required by SRS-2301 and restores a small visual illustration when applicable.
- **SRS-3602** Illustrations include semantics appropriate to the parameter, such as angular error, phase separation, route distance, score band or transfer curve.
- **SRS-3603** Help expands by click/tap and therefore works on touch devices without hover.

## 37. GT trimming and route correction

- **SRS-3701** GT map always shows original/raw trace points needed to choose clip boundaries.
- **SRS-3702** Moving Clip Start or Clip End changes the visual map immediately: samples outside the clip are hidden or strongly de-emphasized while samples inside remain prominent.
- **SRS-3703** Playback time is constrained to the selected clip and is automatically clamped when clip bounds change.
- **SRS-3704** Manual route correction exposes draggable geometry handles/points directly on the map, not only numeric/coarse controls.
- **SRS-3705** The correction workflow must support at least center, leg/length, radius and orientation for a normal hippodrome and preserve the edited geometry in the GT evidence.

## 38. Route Bank parametric editor

- **SRS-3801** Route Bank uses one parametric editing model for Circle and Single Hippodrome: draggable center, radius, orientation and leg-length handles.
- **SRS-3802** Circle has leg length exactly 0. Increasing leg length converts the geometry into a stadium/hippodrome without changing the meaning of the other handles.
- **SRS-3803** The Figure-8 action converts geometry to a self-crossing figure-8 and updates the route subtype.
- **SRS-3804** Double authoring workflow: create/edit two component hippodromes; select exactly two; use “Connect 2 to Double”; produce a new continuous Double route retaining source lineage metadata.
- **SRS-3805** Double editor supports second-leg length and bend/orientation adjustment.
- **SRS-3806** Route Bank remains capable of free point/shape correction where needed, but semantic axis handles are the default ergonomic editing method for circle/hippodrome.

## 39. Influx and Settings UX

- **SRS-3901** Influx UI is split into a clear connection section and a metric-mapping section; it must not present a cramped undifferentiated table on mobile.
- **SRS-3902** Each mapping remains explicit for Bucket, Measurement, Key/Field, value mode and fill/interpolation behavior.
- **SRS-3903** Settings UI separates Servers, Map Sources and Vehicle Types/ID Ranges into clear cards/sections.
- **SRS-3904** Vehicle ID ranges are edited as structured range rows/chips with `min` and `max` plus add/delete actions. Users are not required to enter comma-separated range syntax.

## 40. Per-server simulation and validation

- **SRS-4001** Every configured demo/server used for validation has a substantially different deterministic scenario, not merely shifted coordinates or a different seed.
- **SRS-4002** Baseline three-server suite: Server 1 clean SI/SO baseline; Server 2 membership stress (join/leave/temporary disconnect and co-located SO routes); Server 3 route/period stress (+22% period material change, geometry revision and whole-group SO→SI transition).
- **SRS-4003** Scenario state is time-dependent so moving the time slider exposes the intended transition rather than a static screenshot.
- **SRS-4004** System tests shall be expanded continuously and cover geometry, route detection, grouping, score transfer/sensitivity, Event lifecycle, gaps, replay/checkpoint, per-server transitions, PDF map presence, mobile template actions and interactive editor behavior.
- **SRS-4005** No UI “PASS” is valid merely because a timer elapsed. PASS comes from executable assertions and release-gate evidence.

## 41. v1.1 release gate

A build claiming compliance with this amendment must demonstrate all of the following before a user-facing link is called verified:

1. Python Core tests pass, including angular sensitivity regression.
2. TypeScript type-check, ESLint and production build pass.
3. Automated UI/regression tests pass.
4. Browser QA passes on desktop and iPhone-sized RTL viewport.
5. Template Switch Apply action is reachable on mobile.
6. Correct outward-turn hippodromes are visibly present in Live, Template Preview, GT, Route Bank, Investigation and PDF.
7. Normal trace and score-colored trace are both independently visible.
8. 30/60/90/120 timeline choices demonstrably change the data/x-axis domain.
9. SO +/− builder generates permutations immediately, enforces one vehicle type per physical entity, supports co-located distinct Singles and updates Preview on relation change.
10. PDF contains a summary map and an Event map on every Event page.
11. Preview public URL, login flow, application assets and core API are verified after deployment.
