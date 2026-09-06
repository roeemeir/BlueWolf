# Blue Wolf — SRS Normative Amendment v1.2

**Date:** 2026-09-06  
**Status:** Mandatory, normative amendment to `docs/BLUE_WOLF_SRS.md` and v1.1  
**Precedence:** This amendment is the newest product decision. Where it conflicts with the baseline SRS or v1.1, **v1.2 wins**. Every non-conflicting older requirement remains mandatory.

## 42. SO template semantic model — vehicle-type-independent

- **SRS-4201 (OVERRIDES SRS-3101–3110 where conflicting)** Vehicle type is not a semantic dimension of an SO synchronization template. The SO builder shall describe route topology, occupied logical positions and progression direction only.
- **SRS-4202** All hippodromes in the SO Template Preview are drawn at the same relative reference scale. A real vehicle/route geometry adapts to the selected template at runtime; absolute vehicle-specific route size is not part of template identity.
- **SRS-4203** Two vehicles shown on one logical Single may correspond either to two vehicles on one physical route or to two distinct co-centered physical hippodromes. Those cases are synchronization-law equivalent and shall not create separate template permutations.
- **SRS-4204** Figure-8 is synchronization-equivalent to a Single hippodrome. Figure-8 may remain a geometric/display subtype elsewhere, but it must not create a separate SO synchronization-law dimension.
- **SRS-4205** A Single has two logical halves and supports at most two vehicle slots. The exact physical straight leg is not part of the synchronization law; progression direction is.
- **SRS-4206** A Double supports four logical vehicle slots and at most four vehicles.
- **SRS-4207** Every occupied slot carries an explicit progression direction. The Template Preview draws a direction arrow and the user can reverse progression for each placed vehicle.
- **SRS-4208** `same`, `opposite` and `mixed` are derived from logical phase/slot placement plus progression direction whenever deterministically possible. The UI shall not ask the user to enter redundant relation data that can be inferred from the placement.
- **SRS-4209** The stored SO template is generic. Legacy `vehicleTypes` metadata may be retained only for backward compatibility and must not affect canonical equality or scoring semantics in new templates.

## 43. SO smile visualization and dimensional reduction

- **SRS-4301 (OVERRIDES older 30° smile geometry)** The SO Template Preview uses a deterministic “smile” layout. The middle logical hippodrome is horizontal at `0°`.
- **SRS-4302** Moving one Single step to the right adds `+20°`; moving one Single step to the left adds `−20°`.
- **SRS-4303** A Double is equivalent to two regular hippodrome steps for smile placement and therefore consumes two 20° steps.
- **SRS-4304** The smile geometry is a visualization/canonical editing aid only and must not alter live route detection geometry.
- **SRS-4305** The preview draws the complete closed route even when Single synchronization semantics only require half + progression direction.
- **SRS-4306** Template relation labels shown between neighbors are computed from the normalized slot/direction model and update immediately when a slot or direction changes.

## 44. SO duplicate detection and save behavior

- **SRS-4401** Before saving an SO template, the application computes a canonical signature that ignores vehicle type, absolute route scale and display-only metadata.
- **SRS-4402** Canonical identity includes ordered Single/Double topology, normalized occupied logical slots and progression direction.
- **SRS-4403** For Single, exact physical leg identity is not part of canonical identity; only the number of occupied halves and progression directions are relevant.
- **SRS-4404** If an identical canonical template already exists, Save does not silently create another copy. The user is shown the existing matching template and is offered an explicit **Replace existing** action or Cancel.
- **SRS-4405** Duplicate detection is a release-gated executable rule, not a visual-only warning.

## 45. Live map trail, color semantics and group information

- **SRS-4501** Normal live trail history defaults to **30 minutes**.
- **SRS-4502** Trail history duration is a persistent user/system setting and can be changed in Settings without a code change.
- **SRS-4503 (OVERRIDES SRS-2801, SRS-2803 and SRS-3110 for operational identity)** Operational map identity is by **group**, not by vehicle type. A group keeps the same color on vehicle arrows/markers, route drawing, normal trail, group information cards and time-series graph.
- **SRS-4504** Vehicle type remains available as textual/icon metadata and may retain a palette for configuration screens, but it is not the primary operational color encoding.
- **SRS-4505** All active groups are always represented in the information area. Focusing a group expands extra details; it must not hide the summary of other groups.
- **SRS-4506** Group focus is emphasis/expansion only. It does not recolor the group or remove other groups from map/timeline.
- **SRS-4507 (AMENDS SRS-3002–3004)** Score-colored trail is continuous. When enabled, historical points use a continuous score gradient and a continuous colorbar is visible.
- **SRS-4508** On score-colored trail, group identity remains recoverable, e.g. with a group-colored outline while the point fill encodes score.
- **SRS-4509** Normal trail and score-colored trail remain independently toggleable.

## 46. Time-series graph

- **SRS-4601** All active groups are drawn on one shared time-series graph by default.
- **SRS-4602** The graph provides independent group filtering in addition to metric filtering.
- **SRS-4603** Hiding a group does not change its assigned color; re-enabling it restores the same color.
- **SRS-4604** Metric identity continues to use line style as defined in v1.1; group identity uses color.
- **SRS-4605** Default operational graph/history view is 30 minutes while 30/60/90/120 minute windows remain selectable where previously required.

## 47. Investigation layout and all-event map

- **SRS-4701** Investigation uses a map-first responsive layout. The map shall not be horizontally distorted by a narrow side column; on constrained widths information moves below or into collapsible/resizable regions.
- **SRS-4702** The investigation summary map displays **all Events simultaneously**.
- **SRS-4703** Every Event receives its own stable Event color within the investigation/report context.
- **SRS-4704** All route geometry and historical traces belonging to one Event are drawn in that Event color on the all-event map.
- **SRS-4705** The Event identifier (for example `E3`) is drawn on the map at the centroid/center of mass of that Event’s displayed evidence, with a readability offset if required.
- **SRS-4706** Selecting an Event may emphasize it but must not remove the evidence for the remaining Events from the all-event summary map.
- **SRS-4707** PDF export behavior that already passes QA remains preserved; new screen-layout work must not regress Summary + per-Event maps.

## 48. Event boundaries and Hebrew operator root causes

- **SRS-4801** Every Event stores and displays a detailed **start cause** and **end cause** in clear Hebrew.
- **SRS-4802** Membership causes include the exact vehicle identifier(s) that joined or left.
- **SRS-4803** Period-change causes include previous period, new period, percentage change and persistence duration/evidence when available.
- **SRS-4804** Prolonged route-deviation causes include vehicle identifier, measured deviation, configured threshold and duration beyond threshold when available.
- **SRS-4805** Supported boundary explanations include at least: vehicle join, vehicle leave/withdrawal, end of requested time range, confirmed cycle-time change, prolonged route deviation, confirmed route-geometry revision and confirmed group/formation transition.
- **SRS-4806** Root-cause summaries are operator-oriented: they state what changed, which vehicle was involved, when it happened, the relevant numeric evidence and the operational consequence where available.
- **SRS-4807** Generic English-only labels such as `period change`, `membership` or `root cause` are insufficient when more specific Hebrew evidence is available.

## 49. Wind disturbance simulation and estimation

- **SRS-4901** Simulation includes an optional wind-disturbance model capable of challenging synchronization and producing measurable score degradation.
- **SRS-4902** At minimum the simulator supports steady wind and time-varying/gust components; deterministic server scenarios remain reproducible for QA.
- **SRS-4903** Simulation evidence exposes estimated synchronization degradation attributable to the injected disturbance.
- **SRS-4904** The product includes a per-vehicle wind/disturbance estimator based on the approximation that nominal vehicle speed/command is locally constant over the estimation window.
- **SRS-4905** The estimator compares the expected velocity vector with the measured navigation velocity vector and estimates the residual horizontal disturbance vector.
- **SRS-4906** Wind/disturbance magnitude is displayed in **knots** and direction as a bearing in degrees relative to geographic north (`0° = North`, clockwise positive).
- **SRS-4907** Because navigation-only residuals cannot perfectly separate true wind from controller/model error, UI wording shall identify the value as an **estimated wind/disturbance** and expose a confidence/quality indication where practical.
- **SRS-4908** Core tests cover vector-to-bearing conversion, m/s-to-knots conversion, zero-wind behavior and a known injected-wind case.

## 50. GT route editing, map layers and measurement

- **SRS-5001 (EXTENDS SRS-3701–3705)** GT uses the same semantic manual route-correction behavior as Route Bank: draggable center/axis/length/radius/orientation handles and direct map feedback.
- **SRS-5002** While an axis/orientation handle is dragged, the current numeric angle in degrees is visible next to the control and updates continuously.
- **SRS-5003** GT provides a ruler/measurement tool. The user can choose two points and see their distance; bearing may also be shown.
- **SRS-5004** The measurement overlay is non-semantic: using or clearing the ruler never changes saved route geometry or score.
- **SRS-5005** GT exposes an engineering-map layer and a real configured base-map layer sourced from Settings. The user can select engineering, configured real map, or a combined view when available.
- **SRS-5006** Clip, playback, raw-trace evidence and manual correction remain synchronized on the same map after base-map changes.

## 51. Settings amendments

- **SRS-5101** Settings includes `trailHistoryMinutes`, default `30`, persisted with workspace configuration.
- **SRS-5102** Map-source definitions configured in Settings are reusable by Live, Route Bank and GT rather than copied into screen-specific configuration.
- **SRS-5103** Existing server, Influx, vehicle-ID-range and map-source requirements remain mandatory unless explicitly superseded above.

## 52. v1.2 release gate

A build claiming v1.2 compliance must pass the v1.1 gate plus all of the following:

1. Official SRS index includes baseline + v1.1 + v1.2 and states newest-wins precedence.
2. SO builder is vehicle-type-independent and displays Single/Double generic route entities.
3. SO smile uses 20° per Single step and two steps for a Double.
4. Single is limited to 2 logical slots; Double to 4; every occupied slot can reverse direction.
5. Neighbor relation display is derived from logical placement/direction rather than separately entered redundant state.
6. Duplicate SO Save detects a canonical match, displays the existing template and offers replacement.
7. Live normal trail defaults to 30 minutes from Settings.
8. Operational vehicle/route/trail/info/timeline identity uses stable group colors.
9. Score-colored trail has a continuous gradient and continuous colorbar.
10. All groups remain summarized while focus expands one group.
11. Timeline shows all groups on one graph and supports group filtering.
12. Investigation all-event map draws each Event’s routes + traces in a distinct Event color and labels every Event at its centroid.
13. Investigation layout remains usable at desktop and phone widths without map aspect distortion/forced narrow map columns.
14. Event start/end causes include detailed Hebrew membership/period/route evidence.
15. Wind simulator produces deterministic disturbance and a measurable synchronization impact.
16. Per-vehicle wind/disturbance estimate is available in knots + bearing from north and is covered by executable Core tests.
17. GT exposes engineering/configured-real map choice, live angle value during geometry editing and a working ruler.
18. Python Core tests, TypeScript, ESLint, production build, JS regression tests and browser QA all pass.
19. Public protected preview login, assets and workspace API are verified after deployment before a link is called verified.
