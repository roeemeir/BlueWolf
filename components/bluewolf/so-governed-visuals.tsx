"use client";

import { useEffect, useState } from "react";
import { traceScoreColor } from "@/lib/score-trace";
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
import {
  TemplatePreview as LegacyTemplatePreview,
  VehicleIconGlyph,
  groupLineColor,
  type GroupKey,
} from "./visuals";

const ringRadius: Record<string, number> = { inner: 48, middle: 82, outer: 116 };
const SIM_TICKS_PER_MINUTE = 12;
const SIM_TRACE_RETENTION_MINUTES = 90;
const SIM_TRACE_WINDOWS = [30, 60, 90] as const;

function lerp(a: SoPoint, b: SoPoint, t: number): SoPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function unit(a: SoPoint, b: SoPoint) {
  const length = Math.max(0.0001, Math.hypot(b.x - a.x, b.y - a.y));
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
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

function DirectionCue({ a, b, relation, reverse = false }: { a: SoPoint; b: SoPoint; relation: SoRelation; reverse?: boolean }) {
  const middle = lerp(a, b, .5);
  const direction = unit(a, b);
  const sign = reverse ? -1 : 1;
  const end = { x: middle.x + direction.x * 24 * sign, y: middle.y + direction.y * 24 * sign };
  const start = { x: middle.x - direction.x * 24 * sign, y: middle.y - direction.y * 24 * sign };
  if (relation === "mixed") return <g className="v04-direction-cue mixed"><line x1={start.x} y1={start.y - 5} x2={end.x} y2={end.y - 5} /><line x1={end.x} y1={end.y + 5} x2={start.x} y2={start.y + 5} /><circle cx={middle.x} cy={middle.y} r="4" /></g>;
  return <g className={`v04-direction-cue ${relation}`}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} /><path d={`M${end.x},${end.y} l${-direction.x * 8 + -direction.y * 4},${-direction.y * 8 + direction.x * 4} M${end.x},${end.y} l${-direction.x * 8 + direction.y * 4},${-direction.y * 8 - direction.x * 4}`} /></g>;
}

export function GovernedLiveMap({ serverId, tick, selectedGroup, selectedVehicle, showTrace, showObservedTrace = false, showRoutes, showRelations, showGroups = true, showGrid, traceWindowMinutes = 30, vehicleTypes, templateValues, mapProfile = "engineering", animate = true, onSelectGroup, onSelectVehicle }: { serverId: string; tick: number; selectedGroup: GroupKey; selectedVehicle: number | null; showTrace: boolean; showObservedTrace?: boolean; showRoutes: boolean; showRelations: boolean; showGroups?: boolean; showGrid: boolean; traceWindowMinutes?: number; vehicleTypes: VehicleType[]; templateValues?: Partial<Record<GroupKey, number[]>>; mapProfile?: string; animate?: boolean; onSelectGroup: (key: GroupKey) => void; onSelectVehicle: (id: number, group: GroupKey) => void }) {
  const scenario = getServerScenario(serverId);
  const progress = ((tick * .028) + Number(serverId) * .013) % 1;
  const typeById = (typeId: string) => vehicleTypes.find((type) => type.id === typeId) ?? vehicleTypes[0];
  const siCenter = { x: 235, y: 285 };
  const siPoints = scenario.groups.si.members.map((vehicle) => {
    const radius = ringRadius[vehicle.ring ?? "middle"];
    const angle = (progress + vehicle.phase) * Math.PI * 2;
    return { x: siCenter.x + Math.cos(angle) * radius, y: siCenter.y + Math.sin(angle) * radius, heading: angle * 180 / Math.PI + 180, vehicle };
  });

  const soKinds: SoRouteKind[] = ["single", "double", "single"];
  const soRoutes = buildSoSmileGeometry(soKinds, { centerX: 700, centerY: 220, spacing: 180, risePerStep: 22, radius: 28, singleHalfLeg: 60, doubleHalfLeg: 108 });
  const soMembers = scenario.groups.so.members;
  const soPoints = soMembers.map((vehicle, index) => {
    const routeIndex = index === 0 ? 0 : index === soMembers.length - 1 ? 2 : 1;
    const route = soRoutes[routeIndex];
    const phaseOffset = routeIndex === 1 && index > 1 ? .5 : 0;
    const point = pointAtSoPhase(route.points, (progress + vehicle.phase + phaseOffset) % 1);
    return { ...point, vehicle };
  });

  const [traceFrames, setTraceFrames] = useState<{ server: string; tick: number; points: { x: number; y: number; id: number; sync: number }[] }[]>([]);
  const [observedLayer, setObservedLayer] = useState(showObservedTrace);
  const [routeLayer, setRouteLayer] = useState(true);
  const [groupLayer, setGroupLayer] = useState(showGroups);
  const [traceWindow, setTraceWindow] = useState(traceWindowMinutes);
  useEffect(() => {
    const points = [...siPoints, ...soPoints].map((point) => ({ x: point.x, y: point.y, id: point.vehicle.id, sync: point.vehicle.sync }));
    const retentionTicks = SIM_TRACE_RETENTION_MINUTES * SIM_TICKS_PER_MINUTE;
    setTraceFrames((previous) => [...previous.filter((frame) => frame.server === serverId && frame.tick < tick && frame.tick >= tick - retentionTicks), { server: serverId, tick, points }]);
    // Simulation navigation is deterministic for server/tick; repainting is not a new sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, tick]);

  const relations = (templateValues?.so ?? [2, 0]).map(relationFromCode);
  const mapClass = mapProfile === "orthophoto" ? "orthophoto" : "engineering";
  const windowTicks = Math.max(1, Math.round(traceWindow * SIM_TICKS_PER_MINUTE));
  const visibleTraceFrames = traceFrames.filter((frame) => frame.server === serverId && frame.tick >= tick - windowTicks);
  const traceLines = visibleTraceFrames.slice(1).flatMap((frame, index) => frame.points.flatMap((point) => {
    const prior = visibleTraceFrames[index]?.points.find((item) => item.id === point.id);
    return prior ? [{ frame, point, prior }] : [];
  }));
  return <div className="simulation-map-layer-shell" dir="rtl" data-requirements="OP-02">
    <div className="v04-map-layer-controls" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px" }}>
      <button type="button" className={observedLayer ? "active" : ""} onClick={() => setObservedLayer((value) => !value)}>עקבה נצפית</button>
      <button type="button" className={routeLayer ? "active" : ""} onClick={() => setRouteLayer((value) => !value)}>נתיב מזוהה</button>
      <button type="button" className={groupLayer ? "active" : ""} onClick={() => setGroupLayer((value) => !value)}>קבוצות</button>
      <span aria-label="חלון עקבה">חלון:</span>
      {SIM_TRACE_WINDOWS.map((minutes) => <button type="button" key={minutes} className={traceWindow === minutes ? "active" : ""} onClick={() => setTraceWindow(minutes)}>{minutes} דק׳</button>)}
    </div>
    <svg className={`map-svg v04-live-map ${mapClass}`} viewBox="0 0 1000 570" role="img" aria-label="מפה חיה של קבוצות SI ו-SO" data-requirements="GEO-01 GEO-02 OP-02">
      <defs><pattern id={`v04-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern></defs>
      <rect width="1000" height="570" fill="var(--map-bg)" /><rect width="1000" height="570" className="v04-map-wash" />{showGrid && <rect width="1000" height="570" fill={`url(#v04-grid-${serverId})`} />}
      <g className="v04-map-labels"><text x="38" y="45">SI · טבעות</text><text x="455" y="45">SO · שרשרת היפודרומים</text><text x="455" y="68">30° מדויק · רווח פיזי בין מסלולים · ללא חיבור קצוות</text></g>
      {showRoutes && routeLayer && <g className="v04-routes"><g className={selectedGroup === "si" ? "active" : ""} onClick={() => onSelectGroup("si")}>{(["inner", "middle", "outer"] as const).map((ring) => <circle key={ring} cx={siCenter.x} cy={siCenter.y} r={ringRadius[ring]} className="v04-si-route" />)}</g><g className={selectedGroup === "so" ? "active" : ""} onClick={() => onSelectGroup("so")}>{soRoutes.map((route) => <path key={route.routeIndex} d={route.path} className={`v04-so-route ${route.kind === "double" ? "double" : ""}`} />)}</g></g>}
      {observedLayer && <g className="observed-trace">{traceLines.map(({ frame, point, prior }) => <line key={`observed:${frame.tick}:${point.id}`} x1={prior.x} y1={prior.y} x2={point.x} y2={point.y} stroke="#7b8790" strokeWidth="2" opacity=".58" />)}</g>}
      {showTrace && <g className="score-trace">{traceLines.map(({ frame, point, prior }) => <line key={`score:${frame.tick}:${point.id}`} x1={prior.x} y1={prior.y} x2={point.x} y2={point.y} style={{ stroke: traceScoreColor(point.sync) }} />)}</g>}
      {showRelations && selectedGroup === "so" && <g>{soRoutes.slice(0, -1).map((route, index) => <g key={route.routeIndex}><RelationBadge first={route.center} second={soRoutes[index + 1].center} relation={relations[index] ?? "mixed"} /><DirectionCue a={route.center} b={soRoutes[index + 1].center} relation={relations[index] ?? "mixed"} reverse={relations[index] === "opposite"} /></g>)}</g>}
      {showRelations && selectedGroup === "si" && <g className="v04-si-relations">{siPoints.map((point, index) => siPoints.slice(index + 1).map((other, offset) => { const pairIndex = index * siPoints.length - (index * (index + 1)) / 2 + offset; const angle = templateValues?.si?.[pairIndex] ?? 120; const middle = lerp(point, other, .5); return <g key={`${point.vehicle.id}-${other.vehicle.id}`}><line x1={point.x} y1={point.y} x2={other.x} y2={other.y} /><rect x={middle.x - 24} y={middle.y - 12} width="48" height="24" rx="12" /><text x={middle.x} y={middle.y + 4} textAnchor="middle">{angle}°</text></g>; }))}</g>}
      {groupLayer && <g className="v04-vehicles">{siPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.si} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "si")} />)}{soPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.so} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "so")} />)}</g>}
      <g className="v04-map-scale"><path d="M42 520h90" /><text x="42" y="510">100 מ׳</text><text x="955" y="535" textAnchor="end">{animate ? "LIVE" : "SNAPSHOT"}</text></g>
    </svg>
  </div>;
}

export function GovernedTemplatePreview({ family, values, siPositions, compact = false, title, vehicleTypes = [], soKinds = ["single", "double", "single"] }: { family: Family | GroupKey; values: number[]; siPositions?: import("@/lib/bluewolf").SiPosition[]; compact?: boolean; title?: string; vehicleTypes?: VehicleType[]; soKinds?: SoRouteKind[] }) {
  const normalized = family.toUpperCase() as Family;
  if (normalized === "SI") return <LegacyTemplatePreview family={family} values={values} siPositions={siPositions} compact={compact} title={title} vehicleTypes={vehicleTypes} soKinds={soKinds} />;

  const relations = values.map(relationFromCode);
  const typeColors = vehicleTypes.length ? vehicleTypes.map((item) => item.color) : ["#ff9f43", "#34b7eb", "#9068ff", "#d16ff2", "#4fbf79"];
  const routes = buildSoSmileGeometry(soKinds, { centerX: 200, centerY: 92, spacing: 105, risePerStep: 12, radius: 15, singleHalfLeg: 34, doubleHalfLeg: 58, samplesPerTurn: 12 });
  return <svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox="0 0 400 230" role="img" aria-label={title ?? "תצוגת תבנית SO"} data-requirements="GEO-01 GEO-02">
    <rect width="400" height="230" rx="20" />
    <g className="v04-preview-so">
      {routes.map((route) => <path key={route.routeIndex} d={route.path} className={route.kind === "double" ? "double" : undefined} />)}
      {routes.slice(0, -1).map((route, index) => { const next = routes[index + 1]; const middle = lerp(route.center, next.center, .5); const relation = relations[index] ?? "mixed"; return <g className="v04-preview-relation" key={route.routeIndex}><rect x={middle.x - 48} y={middle.y - 48} width="96" height="25" rx="12" /><text x={middle.x} y={middle.y - 31} textAnchor="middle" stroke="none">{SO_RELATION_LABELS[relation]} · 30°</text></g>; })}
      {routes.map((route, index) => { const phase = soPhasesForRoute(route.kind)[0]; const point = pointAtSoPhase(route.points, phase); return <circle key={`vehicle-${route.routeIndex}`} cx={point.x} cy={point.y} r="7" fill={typeColors[index % typeColors.length]} />; })}
      <text x="200" y="215" textAnchor="middle" stroke="none">{soKinds.map((kind) => kind === "double" ? "כפול" : "יחיד").join(" — ")}</text>
    </g>
  </svg>;
}
