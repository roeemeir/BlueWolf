"use client";

import { useEffect, useState } from "react";
import { traceScoreColor } from "@/lib/score-trace";
import { simulationObservedFix } from "@/lib/simulation-live-navigation";
import { operatorWindowForServer, OPERATOR_SHARED_WINDOWS, setOperatorWindowForServer, subscribeOperatorWindow } from "@/lib/operator-shared-window";
import {
  SO_RELATION_LABELS,
  getServerScenario,
  relationFromCode,
  type Family,
  type SoRelation,
  type SoRouteKind,
  type VehicleType,
} from "@/lib/bluewolf";
import { buildSoSmileGeometry, pointAtSoPhase, soPhasesForRoute, type SoPoint } from "@/lib/so-geometry";
import type { SoDirectPlacement } from "@/lib/so-direct-placement";
import { useWorkspace } from "./app-context";
import {
  TemplatePreview as LegacyTemplatePreview,
  VehicleIconGlyph,
  groupLineColor,
  type GroupKey,
} from "./visuals";

const ringRadius: Record<string, number> = { inner: 48, middle: 82, outer: 116 };
const SIM_TICKS_PER_MINUTE = 12;
const SIM_TRACE_RETENTION_MINUTES = 90;

function lerp(a: SoPoint, b: SoPoint, t: number): SoPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function convexHull(points: SoPoint[]) {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: SoPoint, a: SoPoint, b: SoPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: SoPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: SoPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function VehicleMarker({ x, y, heading, id, color, icon, selected, onClick }: { x: number; y: number; heading: number; id: number; color: string; icon: Parameters<typeof VehicleIconGlyph>[0]["icon"]; selected?: boolean; onClick: () => void }) {
  return <g className={`v04-vehicle ${selected ? "selected" : ""}`} transform={`translate(${x} ${y})`} onClick={onClick} role="button" tabIndex={0} aria-label={`רכב ${id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}>
    {selected && <circle r="19" className="v04-selection-ring" stroke={color} />}
    <g transform={`rotate(${heading})`} className="v04-vehicle-body"><path d="M0-18 7-9 10 9 0 14-10 9-7-9Z" fill="var(--map-card)" stroke={color} strokeWidth="2.4" /><path d="M0-18 4-11H-4Z" fill={color} /><g transform="scale(.72)"><VehicleIconGlyph icon={icon} color={color} /></g></g>
    <g className="v04-id-label" transform="translate(0 27)"><rect x="-17" y="-9" width="34" height="18" rx="9" /><text y="4" textAnchor="middle">{id}</text></g>
  </g>;
}

function RelationBadge({ first, second, relation }: { first: SoPoint; second: SoPoint; relation: SoRelation }) {
  const middle = lerp(first, second, 0.5);
  return <g className="v04-relation"><circle cx={middle.x} cy={middle.y} r="5" /><rect x={middle.x - 55} y={middle.y - 48} width="110" height="30" rx="15" /><text x={middle.x} y={middle.y - 29} textAnchor="middle" stroke="none">{SO_RELATION_LABELS[relation]} · 30°</text></g>;
}

export function GovernedLiveMap({ serverId, tick, selectedGroup, selectedVehicle, showTrace, showObservedTrace = false, showRoutes, showRelations, showGroups = true, showGrid, traceWindowMinutes = 30, vehicleTypes, templateValues, mapProfile = "engineering", animate = true, onSelectGroup, onSelectVehicle }: { serverId: string; tick: number; selectedGroup: GroupKey; selectedVehicle: number | null; showTrace: boolean; showObservedTrace?: boolean; showRoutes: boolean; showRelations: boolean; showGroups?: boolean; showGrid: boolean; traceWindowMinutes?: number; vehicleTypes: VehicleType[]; templateValues?: Partial<Record<GroupKey, number[]>>; mapProfile?: string; animate?: boolean; onSelectGroup: (key: GroupKey) => void; onSelectVehicle: (id: number, group: GroupKey) => void }) {
  const scenario = getServerScenario(serverId);
  const progress = ((tick * .028) + Number(serverId) * .013) % 1;
  const typeById = (typeId: string) => vehicleTypes.find((type) => type.id === typeId) ?? vehicleTypes[0];
  const siCenter = { x: 235, y: 285 };
  const siPoints = scenario.groups.si.members.flatMap((vehicle) => {
    const radius = ringRadius[vehicle.ring ?? "middle"];
    const angle = (progress + vehicle.phase) * Math.PI * 2;
    const ideal = { x: siCenter.x + Math.cos(angle) * radius, y: siCenter.y + Math.sin(angle) * radius, heading: angle * 180 / Math.PI + 180 };
    const observed = simulationObservedFix({ serverId, vehicleId: vehicle.id, tick, ideal });
    return observed ? [{ ...observed, vehicle }] : [];
  });

  const soKinds: SoRouteKind[] = ["single", "double", "single"];
  const soRoutes = buildSoSmileGeometry(soKinds, { centerX: 700, centerY: 220, spacing: 180, risePerStep: 22, radius: 28, singleHalfLeg: 60, doubleHalfLeg: 108 });
  const soMembers = scenario.groups.so.members;
  const soPoints = soMembers.flatMap((vehicle, index) => {
    const routeIndex = index === 0 ? 0 : index === soMembers.length - 1 ? 2 : 1;
    const route = soRoutes[routeIndex];
    const phaseOffset = routeIndex === 1 && index > 1 ? .5 : 0;
    const ideal = pointAtSoPhase(route.points, (progress + vehicle.phase + phaseOffset) % 1);
    const observed = simulationObservedFix({ serverId, vehicleId: vehicle.id, tick, ideal });
    return observed ? [{ ...observed, vehicle }] : [];
  });

  const [traceFrames, setTraceFrames] = useState<{ server: string; tick: number; points: { x: number; y: number; id: number; sync: number }[] }[]>([]);
  const [baseLayer, setBaseLayer] = useState(true);
  const [observedLayer, setObservedLayer] = useState(showObservedTrace);
  const [scoreTraceLayer, setScoreTraceLayer] = useState(showTrace);
  const [routeLayer, setRouteLayer] = useState(true);
  const [groupLayer, setGroupLayer] = useState(showGroups);
  const [templateLayer, setTemplateLayer] = useState(true);
  const [relationLayer, setRelationLayer] = useState(showRelations);
  const [contextLayer, setContextLayer] = useState(showGrid);
  const [traceWindow, setTraceWindow] = useState(() => operatorWindowForServer(serverId));
  useEffect(() => {
    setTraceWindow(operatorWindowForServer(serverId));
    return subscribeOperatorWindow(serverId, setTraceWindow);
  }, [serverId]);
  useEffect(() => setScoreTraceLayer(showTrace), [showTrace]);
  useEffect(() => setRelationLayer(showRelations), [showRelations]);
  useEffect(() => {
    const points = [...siPoints, ...soPoints].map((point) => ({ x: point.x, y: point.y, id: point.vehicle.id, sync: point.vehicle.sync }));
    const retentionTicks = SIM_TRACE_RETENTION_MINUTES * SIM_TICKS_PER_MINUTE;
    setTraceFrames((previous) => [...previous.filter((frame) => frame.server === serverId && frame.tick < tick && frame.tick >= tick - retentionTicks), { server: serverId, tick, points }]);
    // Synthetic observations are deterministic for server/vehicle/tick. A null
    // fix is not inserted into the frame, so it cannot create an invented line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, tick]);

  const relations = (templateValues?.so ?? [2, 0]).map(relationFromCode);
  const mapClass = mapProfile === "orthophoto" ? "orthophoto" : "engineering";
  const windowTicks = Math.max(1, Math.round(traceWindow * SIM_TICKS_PER_MINUTE));
  const visibleTraceFrames = traceFrames.filter((frame) => frame.server === serverId && frame.tick >= tick - windowTicks);
  const traceLines = visibleTraceFrames.slice(1).flatMap((frame, index) => frame.points.flatMap((point) => {
    const previous = visibleTraceFrames[index];
    const prior = previous?.points.find((item) => item.id === point.id);
    // A missing fix, skipped tick or background-tab pause leaves an explicit
    // break; no trace is drawn across a period without observed navigation.
    return prior && frame.tick > previous.tick && frame.tick - previous.tick <= 1 ? [{ frame, point, prior }] : [];
  }));
  return <div className="simulation-map-layer-shell" dir="rtl" data-requirements="OP-02" data-sim-navigation-source="synthetic-sim-navigation">
    <style>{".operator-workspace .v04-map-toolbar{display:none}"}</style>
    <div className="v04-map-time-controls" data-testid="operator-shared-time-window" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "9px 12px", marginBottom: 5 }}>
      <strong>חלון זמן משותף · מפה וגרף</strong>
      <div className="segmented-control" aria-label="חלון זמן משותף למפה ולגרף">
        {OPERATOR_SHARED_WINDOWS.map((minutes) => <button type="button" key={minutes} className={traceWindow === minutes ? "active" : ""} onClick={() => setOperatorWindowForServer(serverId, minutes)}>{minutes} דק׳</button>)}
      </div>
      <span className="card-hint">הנתונים מוצגים רק אם נצברו במסגרת ההרצה; אין יצירה של עקבה חסרה.</span>
    </div>
    <div className="v04-map-layer-controls" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px" }}>
      <strong>שכבות</strong>
      <button type="button" className={baseLayer ? "active" : ""} onClick={() => setBaseLayer((value) => !value)}>בסיס</button>
      <button type="button" className={observedLayer ? "active" : ""} onClick={() => setObservedLayer((value) => !value)}>עקבה נצפית</button>
      <button type="button" className={scoreTraceLayer ? "active" : ""} onClick={() => setScoreTraceLayer((value) => !value)}>עקבה לפי ציון</button>
      <button type="button" className={routeLayer ? "active" : ""} onClick={() => setRouteLayer((value) => !value)}>נתיב מזוהה (SIM: תרחיש, לא Core)</button>
      <button type="button" className={groupLayer ? "active" : ""} onClick={() => setGroupLayer((value) => !value)}>קבוצות</button>
      <button type="button" className={templateLayer ? "active" : ""} onClick={() => setTemplateLayer((value) => !value)}>תבנית</button>
      <button type="button" className={relationLayer ? "active" : ""} onClick={() => setRelationLayer((value) => !value)}>יחסים</button>
      <button type="button" className={contextLayer ? "active" : ""} onClick={() => setContextLayer((value) => !value)}>רשת</button>
      <span className="card-hint" data-sim-observation-note>SIM · GPS סינתטי עם רעש, רוח וחורי מדידה; לא תצפיות Core</span>
    </div>
    <svg className={`map-svg v04-live-map ${mapClass}`} viewBox="0 0 1000 570" role="img" aria-label="מפת סימולציה סינתטית של קבוצות SI ו-SO" data-requirements="GEO-01 GEO-02 OP-02">
      <defs><pattern id={`v04-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern></defs>
      <rect width="1000" height="570" fill="var(--map-bg)" />{baseLayer && <rect width="1000" height="570" className="v04-map-wash" />}{contextLayer && <rect width="1000" height="570" fill={`url(#v04-grid-${serverId})`} />}
      <g className="v04-map-labels"><text x="38" y="45">SI · טבעות</text><text x="455" y="45">SO · שרשרת היפודרומים</text><text x="455" y="68">30° מדויק · רווח פיזי בין מסלולים · ללא חיבור קצוות</text></g>
      {templateLayer && <g aria-label="שכבת תבנית" opacity=".48">{(["inner", "middle", "outer"] as const).map((ring) => <circle key={`tpl-${ring}`} cx={siCenter.x} cy={siCenter.y} r={ringRadius[ring]} fill="none" stroke={groupLineColor.si} strokeWidth="1.5" strokeDasharray="8 6" />)}{soRoutes.map((route) => <path key={`tpl-${route.routeIndex}`} d={route.path} fill="none" stroke={groupLineColor.so} strokeWidth="1.5" strokeDasharray="8 6" />)}</g>}
      {showRoutes && routeLayer && <g className="v04-routes"><g className={selectedGroup === "si" ? "active" : ""} onClick={() => onSelectGroup("si")}>{(["inner", "middle", "outer"] as const).map((ring) => <circle key={ring} cx={siCenter.x} cy={siCenter.y} r={ringRadius[ring]} className="v04-si-route" style={{ stroke: groupLineColor.si }} />)}</g><g className={selectedGroup === "so" ? "active" : ""} onClick={() => onSelectGroup("so")}>{soRoutes.map((route) => <path key={route.routeIndex} d={route.path} className={`v04-so-route ${route.kind === "double" ? "double" : ""}`} style={{ stroke: groupLineColor.so, strokeDasharray: "none" }} />)}</g></g>}
      {observedLayer && <g className="observed-trace">{traceLines.map(({ frame, point, prior }) => <line key={`observed:${frame.tick}:${point.id}`} x1={prior.x} y1={prior.y} x2={point.x} y2={point.y} stroke="#7b8790" strokeWidth="2" opacity=".58" />)}</g>}
      {scoreTraceLayer && <g className="score-trace">{traceLines.map(({ frame, point, prior }) => <line key={`score:${frame.tick}:${point.id}`} x1={prior.x} y1={prior.y} x2={point.x} y2={point.y} style={{ stroke: traceScoreColor(point.sync) }} />)}</g>}
      {relationLayer && selectedGroup === "so" && <g>{soRoutes.slice(0, -1).map((route, index) => <RelationBadge key={route.routeIndex} first={route.center} second={soRoutes[index + 1].center} relation={relations[index] ?? "mixed"} />)}</g>}
      {relationLayer && selectedGroup === "si" && <g className="v04-si-relations">{siPoints.map((point, index) => siPoints.slice(index + 1).map((other, offset) => { const pairIndex = index * siPoints.length - (index * (index + 1)) / 2 + offset; const angle = templateValues?.si?.[pairIndex] ?? 120; const middle = lerp(point, other, .5); return <g key={`${point.vehicle.id}-${other.vehicle.id}`}><line x1={point.x} y1={point.y} x2={other.x} y2={other.y} /><rect x={middle.x - 24} y={middle.y - 12} width="48" height="24" rx="12" /><text x={middle.x} y={middle.y + 4} textAnchor="middle">{angle}°</text></g>; }))}</g>}
      {groupLayer && <g className="v04-group-shapes">{siPoints.length >= 3 && <polygon points={convexHull(siPoints).map((point) => `${point.x},${point.y}`).join(" ")} fill={groupLineColor.si} fillOpacity=".08" stroke={groupLineColor.si} strokeOpacity=".65" strokeWidth="2" />}</g>}
      {groupLayer && <g className="v04-vehicles">{siPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.si} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "si")} />)}{soPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.so} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "so")} />)}</g>}
      <g className="v04-map-scale"><path d="M42 520h90" /><text x="42" y="510">100 מ׳</text><text x="955" y="535" textAnchor="end">{animate ? "SIM · SYNTHETIC" : "SIM SNAPSHOT"}</text></g>
    </svg>
  </div>;
}

/** A SO selection preview must render the SAVED anonymous slots/directions, not
 * one fabricated forward-moving vehicle per route. The operator passes the
 * selected template's value/chain arrays through unchanged; match their
 * identities within the current workspace, including when two templates have
 * identical relation codes but different direct placements. */
export function GovernedTemplatePreview({ family, values, siPositions, compact = false, title, vehicleTypes = [], soKinds = ["single", "double", "single"] }: { family: Family | GroupKey; values: number[]; siPositions?: import("@/lib/bluewolf").SiPosition[]; compact?: boolean; title?: string; vehicleTypes?: VehicleType[]; soKinds?: SoRouteKind[] }) {
  const { state } = useWorkspace();
  const normalized = family.toUpperCase() as Family;
  if (normalized === "SI") return <LegacyTemplatePreview family={family} values={values} siPositions={siPositions} compact={compact} title={title} vehicleTypes={vehicleTypes} soKinds={soKinds} />;

  const relations = values.map(relationFromCode);
  const selectedTemplate = state.templates.find((template) => template.family === "SO" && template.values === values && template.soSpec?.chain === soKinds);
  const storedPlacements = (selectedTemplate?.soSpec as (import("@/lib/bluewolf").SoTemplateSpec & { directPlacements?: SoDirectPlacement[] }) | undefined)?.directPlacements;
  const placements = Array.isArray(storedPlacements) ? storedPlacements.filter((placement) => Number.isInteger(placement.routeIndex) && Number.isFinite(placement.phase) && (placement.direction === "forward" || placement.direction === "reverse")) : [];
  const typeColors = vehicleTypes.length ? vehicleTypes.map((item) => item.color) : ["#ff9f43", "#34b7eb", "#9068ff", "#d16ff2", "#4fbf79"];
  const width = Math.max(400, 110 * soKinds.length + 70);
  const routes = buildSoSmileGeometry(soKinds, { centerX: width / 2, centerY: 92, spacing: 105, risePerStep: 12, radius: 15, singleHalfLeg: 34, doubleHalfLeg: 58, samplesPerTurn: 12 });
  return <svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox={`0 0 ${width} 230`} role="img" aria-label={title ?? "תצוגת תבנית SO וכיוון התקדמות הרכבים"} data-requirements="GEO-01 GEO-02 SO-02" data-testid="so-template-direction-preview">
    <rect width={width} height="230" rx="20" />
    <g className="v04-preview-so">
      {routes.map((route) => <path key={route.routeIndex} d={route.path} className={route.kind === "double" ? "double" : undefined} />)}
      {routes.slice(0, -1).map((route, index) => { const next = routes[index + 1]; const middle = lerp(route.center, next.center, .5); const relation = relations[index] ?? "mixed"; return <g className="v04-preview-relation" key={route.routeIndex}><rect x={middle.x - 48} y={middle.y - 48} width="96" height="25" rx="12" /><text x={middle.x} y={middle.y - 31} textAnchor="middle" stroke="none">{SO_RELATION_LABELS[relation]} · 30°</text></g>; })}
      {placements.map((placement, index) => {
        const route = routes[placement.routeIndex];
        if (!route || !soPhasesForRoute(route.kind).includes(placement.phase)) return null;
        const point = pointAtSoPhase(route.points, placement.phase, placement.direction === "reverse");
        const color = typeColors[index % typeColors.length];
        return <g key={`${placement.routeIndex}:${placement.phase}`} data-testid={`so-preview-direction-${placement.routeIndex}-${placement.phase}`} data-direction={placement.direction} aria-label={`מיקום ${index + 1}, ${placement.direction === "reverse" ? "כיוון הפוך" : "כיוון קדימה"}`}>
          <g transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`}>
            <circle r="8" style={{ fill: color, stroke: "var(--map-card)", strokeWidth: 1.8 }} />
            <path d="M0 -23 L-6 -11 L6 -11 Z" style={{ fill: color, stroke: "var(--map-card)", strokeWidth: 1.5 }} />
            <path d="M0 -9 V-16" style={{ fill: "none", stroke: color, strokeWidth: 2.5 }} />
          </g>
          <text x={point.x} y={point.y + 25} textAnchor="middle" stroke="none" style={{ fill: "var(--text)", fontWeight: 700, fontSize: 11 }}>{index + 1}</text>
        </g>;
      })}
      <text x={width / 2} y="215" textAnchor="middle" stroke="none">{placements.length ? "▲ חץ = כיוון התקדמות · מספר = מיקום בתבנית" : "בתבנית זו לא נשמר כיוון התקדמות פרטני"}</text>
    </g>
  </svg>;
}
