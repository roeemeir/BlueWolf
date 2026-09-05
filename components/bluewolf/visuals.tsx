"use client";

import { useRef, useState } from "react";
import { MapPinned } from "lucide-react";

import {
  SO_RELATION_LABELS,
  getServerScenario,
  relationFromCode,
  scoreSeriesForServer,
  type DemoGroupKey,
  type Family,
  type SavedRoute,
  type SoRelation,
  type SoRouteKind,
  type VehicleIconName,
  type VehicleType,
} from "@/lib/bluewolf";
import {
  LoadingScreen,
  MapLoadingOverlay,
  ScoreRing,
  VehicleIconGlyph,
} from "./visuals-legacy";

export { LoadingScreen, MapLoadingOverlay, ScoreRing, VehicleIconGlyph };

export type GroupKey = DemoGroupKey;
export type ScoreLayer = "total" | "sync" | "route";
export const DEMO_GROUPS = getServerScenario("1").groups;
export const groupLineColor: Record<GroupKey, string> = { si: "#19a99a", so: "#5577e8" };

type Point = { x: number; y: number };
type DirectedPoint = Point & { heading: number };

const TAU = Math.PI * 2;
const ringRadius: Record<string, number> = { inner: 48, middle: 82, outer: 116 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function rotate(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

function unit(a: Point, b: Point) {
  const len = Math.max(0.0001, distance(a, b));
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

function normal(a: Point, b: Point) {
  const u = unit(a, b);
  return { x: -u.y, y: u.x };
}

function stadiumLoop(a: Point, b: Point, radius: number, count = 120): Point[] {
  const u = unit(a, b);
  const n = normal(a, b);
  const straight = distance(a, b);
  const turn = Math.PI * radius;
  const perimeter = 2 * straight + 2 * turn;
  const result: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    let s = index / count * perimeter;
    if (s < straight) {
      result.push({ x: a.x + n.x * radius + u.x * s, y: a.y + n.y * radius + u.y * s });
      continue;
    }
    s -= straight;
    if (s < turn) {
      const angle = Math.PI / 2 - s / radius;
      result.push({
        x: b.x + Math.cos(angle) * n.x * radius + Math.sin(angle) * u.x * radius,
        y: b.y + Math.cos(angle) * n.y * radius + Math.sin(angle) * u.y * radius,
      });
      continue;
    }
    s -= turn;
    if (s < straight) {
      result.push({ x: b.x - n.x * radius - u.x * s, y: b.y - n.y * radius - u.y * s });
      continue;
    }
    s -= straight;
    const angle = -Math.PI / 2 - s / radius;
    result.push({
      x: a.x + Math.cos(angle) * n.x * radius + Math.sin(angle) * u.x * radius,
      y: a.y + Math.cos(angle) * n.y * radius + Math.sin(angle) * u.y * radius,
    });
  }
  return result;
}

function catmullClosed(control: Point[], steps = 9): Point[] {
  const out: Point[] = [];
  const count = control.length;
  for (let i = 0; i < count; i += 1) {
    const p0 = control[(i - 1 + count) % count];
    const p1 = control[i];
    const p2 = control[(i + 1) % count];
    const p3 = control[(i + 2) % count];
    for (let j = 0; j < steps; j += 1) {
      const t = j / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

/**
 * Authoritative Double SO visual topology.
 * One continuous articulated/dog-bone loop with two lobes and a central waist.
 * It is deliberately not two capsules connected by a cosmetic line.
 */
function doubleHippodromeLoop(center: Point, scale = 1, rotationDeg = 0): Point[] {
  const raw = [
    [-178, 18], [-168, -34], [-132, -76], [-82, -88], [-43, -58], [-17, -25],
    [0, -10], [23, -36], [63, -75], [116, -83], [166, -47], [184, 4],
    [166, 53], [116, 84], [65, 72], [28, 39], [3, 14], [-22, 38],
    [-63, 80], [-118, 89], [-163, 62],
  ].map(([x, y]) => rotate({ x: center.x + x * scale, y: center.y + y * scale }, center, rotationDeg));
  return catmullClosed(raw, 8);
}

function figureEightLoop(center: Point, sx = 95, sy = 48, rotationDeg = 0, count = 140): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.31) / count * TAU;
    points.push(rotate({ x: center.x + sx * Math.sin(t), y: center.y + sy * Math.sin(2 * t) }, center, rotationDeg));
  }
  return points;
}

function closedPath(points: Point[]) {
  if (!points.length) return "";
  return `M${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" L")} Z`;
}

function pointOnClosed(points: Point[], phase: number): DirectedPoint {
  if (!points.length) return { x: 0, y: 0, heading: 0 };
  const normalized = ((phase % 1) + 1) % 1;
  const lengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let target = normalized * total;
  for (let index = 0; index < points.length; index += 1) {
    const segment = lengths[index];
    if (target <= segment || index === points.length - 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const t = clamp(target / Math.max(0.0001, segment), 0, 1);
      const point = lerp(a, b, t);
      return { ...point, heading: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90 };
    }
    target -= segment;
  }
  return { ...points[0], heading: 0 };
}

function typeColor(vehicleTypes: VehicleType[], typeId: string, fallback: string) {
  return vehicleTypes.find((item) => item.id === typeId)?.color ?? fallback;
}

function VehicleMarker({ x, y, heading, id, color, icon, selected, onClick }: { x: number; y: number; heading: number; id: number; color: string; icon: VehicleIconName; selected?: boolean; onClick: () => void }) {
  return <g className={`v04-vehicle ${selected ? "selected" : ""}`} transform={`translate(${x} ${y})`} onClick={onClick} role="button" tabIndex={0} aria-label={`רכב ${id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}>
    {selected && <circle r="19" className="v04-selection-ring" stroke={color} />}
    <g transform={`rotate(${heading})`} className="v04-vehicle-body">
      <circle r="13" fill="var(--map-card)" stroke={color} strokeWidth="2.2" />
      <path d="M0-16 8 10 0 6-8 10Z" fill={color} stroke="var(--map-card)" strokeWidth="1.4" />
      <g transform="scale(.46) translate(0 3)"><VehicleIconGlyph icon={icon} color="var(--map-card)" /></g>
    </g>
    <g className="v04-id-label" transform="translate(0 27)"><rect x="-17" y="-9" width="34" height="18" rx="9" /><text y="4" textAnchor="middle">{id}</text></g>
  </g>;
}

function RelationBadge({ x, y, relation }: { x: number; y: number; relation: SoRelation }) {
  return <g className="v04-relation"><rect x={x - 45} y={y - 15} width="90" height="30" rx="15" /><text x={x} y={y + 4} textAnchor="middle">{SO_RELATION_LABELS[relation]}</text></g>;
}

function EngineeringBackground({ id, showGrid }: { id: string; showGrid: boolean }) {
  return <>
    <defs><pattern id={`grid-${id}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern></defs>
    <rect width="1000" height="570" fill="var(--map-bg)" />
    <rect width="1000" height="570" className="v04-map-wash" />
    {showGrid && <rect width="1000" height="570" fill={`url(#grid-${id})`} />}
    <g className="v08-engineering-map" fill="none">
      <path d="M20 470 C180 390 300 505 470 395 S760 270 980 330" />
      <path d="M60 92 C240 160 350 120 500 70 S760 55 955 120" />
      <path d="M-20 230 C170 180 320 265 470 215 S770 160 1030 235" />
      <path d="M420 110h98v62h-98zM804 402h118v75H804z" />
    </g>
  </>;
}

const SO_LAYOUT = {
  left: stadiumLoop({ x: 475, y: 405 }, { x: 575, y: 308 }, 29),
  double: doubleHippodromeLoop({ x: 735, y: 270 }, 0.62, -7),
  right: stadiumLoop({ x: 895, y: 225 }, { x: 962, y: 137 }, 27),
};

const SO_RELATION_POINTS = [
  { x: 585, y: 245 },
  { x: 892, y: 315 },
];

export function LiveMap({ serverId, tick, selectedGroup, selectedVehicle, showTrace, showRoutes, showRelations, showGrid, vehicleTypes, templateValues, mapProfile = "engineering", animate = true, onSelectGroup, onSelectVehicle }: { serverId: string; tick: number; selectedGroup: GroupKey; selectedVehicle: number | null; showTrace: boolean; showRoutes: boolean; showRelations: boolean; showGrid: boolean; vehicleTypes: VehicleType[]; templateValues?: Partial<Record<GroupKey, number[]>>; mapProfile?: string; animate?: boolean; onSelectGroup: (key: GroupKey) => void; onSelectVehicle: (id: number, group: GroupKey) => void }) {
  const scenario = getServerScenario(serverId);
  const progress = ((tick * 0.028) + Number(serverId) * 0.013) % 1;
  const siCenter = { x: 235, y: 285 };
  const siPoints = scenario.groups.si.members.map((vehicle) => {
    const radius = ringRadius[vehicle.ring ?? "middle"];
    const angle = (progress + vehicle.phase) * TAU;
    return { x: siCenter.x + Math.cos(angle) * radius, y: siCenter.y + Math.sin(angle) * radius, heading: angle * 180 / Math.PI + 180, vehicle };
  });
  const soMembers = scenario.groups.so.members;
  const routeForIndex = (index: number) => index === 0 ? SO_LAYOUT.left : index === soMembers.length - 1 ? SO_LAYOUT.right : SO_LAYOUT.double;
  const soPoints = soMembers.map((vehicle, index) => ({ ...pointOnClosed(routeForIndex(index), progress + vehicle.phase + (index === 2 ? 0.5 : 0)), vehicle }));
  const relations = (templateValues?.so ?? [2, 0]).map(relationFromCode);
  const typeById = (typeId: string) => vehicleTypes.find((type) => type.id === typeId) ?? vehicleTypes[0];
  const traceDots = (route: Point[], phase: number, color: string, key: string) => Array.from({ length: 9 }, (_, index) => {
    const point = pointOnClosed(route, phase - (index + 1) * 5 / 74);
    return <circle key={`${key}-${index}`} cx={point.x} cy={point.y} r="3.1" fill={color} opacity={0.18 + index * 0.065} />;
  });

  return <svg className={`map-svg v04-live-map ${mapProfile === "orthophoto" ? "orthophoto" : "engineering"}`} viewBox="0 0 1000 570" role="img" aria-label="מפה חיה של קבוצות SI ו-SO">
    <EngineeringBackground id={serverId} showGrid={showGrid} />
    <g className="v04-map-labels"><text x="38" y="45">SI · טבעות</text><text x="455" y="45">SO · שרשרת גיאומטרית</text><text x="455" y="68">יחיד — כפול רציף — יחיד · ללא זווית קשיחה</text></g>
    <g className="v08-group-hulls">
      <circle cx={siCenter.x} cy={siCenter.y} r="145" fill="rgba(25,169,154,.045)" stroke={groupLineColor.si} strokeWidth="2" strokeDasharray="8 8" />
      <path d="M425 465 Q610 545 980 410 Q1022 215 940 92 Q720 42 500 185 Q430 285 425 465Z" fill="rgba(85,119,232,.045)" stroke={groupLineColor.so} strokeWidth="2" strokeDasharray="8 8" />
    </g>
    {showRoutes && <g className="v04-routes">
      <g className={selectedGroup === "si" ? "active" : ""} onClick={() => onSelectGroup("si")}>{(["inner", "middle", "outer"] as const).map((ring) => <circle key={ring} cx={siCenter.x} cy={siCenter.y} r={ringRadius[ring]} className="v04-si-route" stroke={typeColor(vehicleTypes, scenario.groups.si.members[0]?.typeId ?? "", groupLineColor.si)} />)}</g>
      <g className={selectedGroup === "so" ? "active" : ""} onClick={() => onSelectGroup("so")}>
        <path d={closedPath(SO_LAYOUT.left)} className="v04-so-route" stroke={typeColor(vehicleTypes, soMembers[0]?.typeId ?? "", groupLineColor.so)} />
        <path d={closedPath(SO_LAYOUT.double)} className="v04-so-route double v08-continuous-double" stroke={typeColor(vehicleTypes, soMembers[1]?.typeId ?? "", groupLineColor.so)} />
        <path d={closedPath(SO_LAYOUT.right)} className="v04-so-route" stroke={typeColor(vehicleTypes, soMembers.at(-1)?.typeId ?? "", groupLineColor.so)} />
      </g>
    </g>}
    {showTrace && <g className="v04-traces v08-trace-dots">
      {siPoints.flatMap((item) => Array.from({ length: 9 }, (_, index) => { const phase = progress + item.vehicle.phase - (index + 1) * 5 / 46; const angle = phase * TAU; const radius = ringRadius[item.vehicle.ring ?? "middle"]; return <circle key={`si-${item.vehicle.id}-${index}`} cx={siCenter.x + Math.cos(angle) * radius} cy={siCenter.y + Math.sin(angle) * radius} r="3.1" fill={groupLineColor.si} opacity={0.18 + index * 0.065} />; }))}
      {soPoints.flatMap((item, index) => traceDots(routeForIndex(index), progress + item.vehicle.phase + (index === 2 ? 0.5 : 0), groupLineColor.so, `so-${item.vehicle.id}`))}
    </g>}
    {showRelations && selectedGroup === "so" && <g>{SO_RELATION_POINTS.map((point, index) => <RelationBadge key={index} x={point.x} y={point.y} relation={relations[index] ?? (index === 0 ? "opposite" : "same")} />)}</g>}
    {showRelations && selectedGroup === "si" && <g className="v04-si-relations">{siPoints.flatMap((point, first) => siPoints.slice(first + 1).map((other) => {
      const a = Math.atan2(point.y - siCenter.y, point.x - siCenter.x);
      const b = Math.atan2(other.y - siCenter.y, other.x - siCenter.x);
      const raw = Math.abs((a - b) * 180 / Math.PI) % 360;
      const angle = Math.round(Math.min(raw, 360 - raw));
      const mid = lerp(point, other, 0.5);
      return <g key={`${point.vehicle.id}-${other.vehicle.id}`}><line x1={point.x} y1={point.y} x2={other.x} y2={other.y} /><rect x={mid.x - 24} y={mid.y - 12} width="48" height="24" rx="12" /><text x={mid.x} y={mid.y + 4} textAnchor="middle">{angle}°</text></g>;
    }))}</g>}
    <g className="v04-vehicles">
      {siPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.si} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "si")} />)}
      {soPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.so} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "so")} />)}
    </g>
    <g className="v04-map-scale"><path d="M42 520h90" /><text x="42" y="510">100 מ׳</text><text x="955" y="535" textAnchor="end">{animate ? "LIVE" : "SNAPSHOT"}</text></g>
  </svg>;
}

export function TimelineChart({ serverId = "1", selected, layers, cursor, onCursor, fromLabel = "17:00", toLabel = "19:00", selectedVehicle }: { serverId?: string; selected: GroupKey; layers: ScoreLayer[]; cursor: number; onCursor: (value: number) => void; fromLabel?: string; toLabel?: string; selectedVehicle?: number | null }) {
  const series = scoreSeriesForServer(serverId, 120);
  const left = 52; const right = 962; const top = 20; const bottom = 205;
  const safe = Math.max(0, Math.min(series.length - 1, cursor));
  const x = (index: number) => left + index / (series.length - 1) * (right - left);
  const y = (score: number) => bottom - score / 100 * (bottom - top);
  const layerPoints = (group: GroupKey, layer: ScoreLayer) => series.map((item) => `${x(item.index)},${y(item[group][layer])}`).join(" ");
  const styles: Record<ScoreLayer, { width: number; dash?: string; opacity: number }> = {
    total: { width: 4.2, opacity: 1 },
    sync: { width: 2.4, dash: "10 6", opacity: 0.82 },
    route: { width: 2.2, dash: "2 7", opacity: 0.78 },
  };
  const eventBands = [{ from: 0, to: 38, group: "si" as GroupKey, label: "E1" }, { from: 43, to: 83, group: "so" as GroupKey, label: "E2" }, { from: 88, to: 119, group: "si" as GroupKey, label: "E3" }];
  return <svg className="timeline-svg v04-timeline" viewBox="0 0 1000 276" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const relative = (event.clientX - rect.left) / rect.width; onCursor(Math.round(clamp(relative, 0, 1) * (series.length - 1))); }}>
    {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="chart-grid" /><text x="42" y={y(score) + 4} textAnchor="end" className="chart-label">{score}</text></g>)}
    {layers.flatMap((layer) => (["si", "so"] as GroupKey[]).map((group) => { const style = styles[layer]; return <polyline key={`${group}-${layer}`} points={layerPoints(group, layer)} fill="none" stroke={groupLineColor[group]} strokeWidth={style.width} strokeDasharray={style.dash} opacity={(group === selected ? 1 : 0.58) * style.opacity} />; }))}
    {selectedVehicle && <text x="958" y="18" textAnchor="end" className="chart-label">רכב {selectedVehicle}</text>}
    <line x1={x(safe)} x2={x(safe)} y1={top} y2={bottom} className="cursor-line" />
    <g className="v04-event-bands">{eventBands.map((band) => <g key={band.label}><rect x={x(band.from)} y="218" width={Math.max(12, x(band.to) - x(band.from))} height="14" rx="7" fill={groupLineColor[band.group]} opacity=".35" /><text x={x(band.from) + 5} y="248">{band.label}</text></g>)}</g>
    <g className="v08-line-legend" transform="translate(520 263)"><line x1="0" x2="30" y1="0" y2="0" stroke="currentColor" strokeWidth="4" /><text x="36" y="4">כולל</text><line x1="100" x2="130" y1="0" y2="0" stroke="currentColor" strokeWidth="2" strokeDasharray="10 6" /><text x="136" y="4">סנכרון</text><line x1="218" x2="248" y1="0" y2="0" stroke="currentColor" strokeWidth="2" strokeDasharray="2 7" /><text x="254" y="4">נתיב</text></g>
    <text x={left} y="272" className="chart-label">{fromLabel}</text><text x={right} y="272" textAnchor="end" className="chart-label">{toLabel}</text>
  </svg>;
}

function siPreview(values: number[], typeColors: string[]) {
  const count = clamp(values.length + 1, 2, 6);
  const sequential = Array.from({ length: count - 1 }, (_, index) => values[index] ?? 120);
  const angles = [0];
  sequential.forEach((value) => angles.push((angles.at(-1) ?? 0) + value));
  const radii = [86, 64, 86, 64, 86, 64];
  const points = angles.map((angle, index) => { const radius = radii[index]; const rad = (angle - 90) * Math.PI / 180; return { x: 200 + Math.cos(rad) * radius, y: 115 + Math.sin(rad) * radius }; });
  return <><circle cx="200" cy="115" r="42" className="ring inner" /><circle cx="200" cy="115" r="64" className="ring middle" /><circle cx="200" cy="115" r="86" className="ring outer" />{points.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="9" fill={typeColors[index % typeColors.length]} /><text x={point.x} y={point.y - 14} textAnchor="middle">R{index + 1}</text></g>)}{sequential.map((value, index) => { const a = points[index]; const b = points[index + 1]; const mid = lerp(a, b, 0.5); return <g className="v04-preview-pairs" key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><rect x={mid.x - 23} y={mid.y - 11} width="46" height="22" rx="11" /><text x={mid.x} y={mid.y + 4} textAnchor="middle">{value}°</text></g>; })}</>;
}

function soTemplateGeometry(kinds: SoRouteKind[]) {
  const normalized = kinds.length ? kinds : ["single", "double", "single"];
  const spacing = normalized.length <= 2 ? 165 : normalized.length === 3 ? 125 : 90;
  const start = 200 - spacing * (normalized.length - 1) / 2;
  return normalized.map((kind, index) => {
    const center = { x: start + index * spacing, y: 122 + 28 * Math.sin((index - (normalized.length - 1) / 2) * 1.15) };
    const rotation = [-34, -8, 27, 48][index % 4];
    const points = kind === "double" ? doubleHippodromeLoop(center, 0.25, rotation)
      : kind === "figure8" || kind === "double-figure8" ? figureEightLoop(center, 48, 24, rotation, 90)
      : stadiumLoop(rotate({ x: center.x - 42, y: center.y }, center, rotation), rotate({ x: center.x + 42, y: center.y }, center, rotation), 16, 84);
    return { kind, center, points };
  });
}

export function TemplatePreview({ family, values, compact = false, title, vehicleTypes = [], soKinds = ["single", "double", "single"] }: { family: Family | GroupKey; values: number[]; compact?: boolean; title?: string; vehicleTypes?: VehicleType[]; soKinds?: SoRouteKind[] }) {
  const normalized = family.toUpperCase() as Family;
  const typeColors = vehicleTypes.length ? vehicleTypes.map((item) => item.color) : ["#ff9f43", "#34b7eb", "#9068ff", "#d16ff2", "#4fbf79"];
  if (normalized === "SI") return <svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox="0 0 400 230" role="img" aria-label={title ?? "תצוגת תבנית SI"}><rect width="400" height="230" rx="20" />{siPreview(values, typeColors)}</svg>;
  const relations = values.map(relationFromCode);
  const entities = soTemplateGeometry(soKinds);
  return <svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox="0 0 400 230" role="img" aria-label={title ?? "תצוגת תבנית SO"}><rect width="400" height="230" rx="20" /><g className="v04-preview-so">{entities.map((entity, index) => <g key={`${entity.kind}-${index}`}><path d={closedPath(entity.points)} stroke={typeColors[index % typeColors.length]} className={entity.kind === "double" ? "double v08-continuous-double" : ""} />{[0.14, 0.55].slice(0, entity.kind === "single" ? 1 : 2).map((phase, markerIndex) => { const point = pointOnClosed(entity.points, phase); return <g key={markerIndex} transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`}><circle r="7" fill={typeColors[(index + markerIndex) % typeColors.length]} /><path d="M0-9 5 6 0 3-5 6Z" fill="var(--map-card)" /></g>; })}</g>)}{entities.slice(0, -1).map((entity, index) => { const next = entities[index + 1]; const point = lerp(entity.center, next.center, 0.5); return <RelationBadge key={index} x={point.x} y={point.y - 42} relation={relations[index] ?? "same"} />; })}<text x="200" y="215" textAnchor="middle">{soKinds.map((kind) => kind === "double" ? "כפול" : kind === "figure8" ? "8" : "יחיד").join(" — ")}</text></g></svg>;
}

export function EventMiniMap({ family, color }: { family: GroupKey; color: string }) {
  const double = doubleHippodromeLoop({ x: 40, y: 18 }, 0.16, -6);
  return <div className="event-mini-map v04-event-mini"><MapPinned /><span>{family.toUpperCase()}</span>{family === "si" ? <div className="mini-circle-route" style={{ borderColor: color }} /> : <svg viewBox="0 0 80 36"><path d={closedPath(double)} stroke={color} fill="none" /></svg>}</div>;
}

export function EventOverviewMap({ eventLabels = ["E1", "E2", "E3"] }: { eventLabels?: string[] }) {
  const double = doubleHippodromeLoop({ x: 505, y: 145 }, 0.42, -8);
  return <svg className="v04-overview-map" viewBox="0 0 720 300"><rect width="720" height="300" rx="22" /><g className="v04-overview-routes"><circle cx="150" cy="150" r="75" /><circle cx="150" cy="150" r="49" /><path d={closedPath(stadiumLoop({ x: 320, y: 215 }, { x: 395, y: 140 }, 22, 80))} /><path d={closedPath(double)} className="v08-continuous-double" /><path d={closedPath(stadiumLoop({ x: 590, y: 180 }, { x: 650, y: 105 }, 20, 80))} /></g>{eventLabels.map((label, index) => <g className="v04-overview-event" key={label} transform={`translate(${[150, 445, 585][index % 3]} ${[150, 145, 175][index % 3]})`}><circle r="17" /><text y="5" textAnchor="middle">{label}</text></g>)}</svg>;
}

export function GtPlayback({ family, progress, vehicleTypes }: { family: Family; progress: number; vehicleTypes: VehicleType[] }) {
  const tick = Math.round(progress * 90);
  return <div className="v04-gt-playback"><LiveMap serverId="1" tick={tick} selectedGroup={family.toLowerCase() as GroupKey} selectedVehicle={null} showTrace={false} showRoutes showRelations showGrid={false} vehicleTypes={vehicleTypes} animate={false} onSelectGroup={() => undefined} onSelectVehicle={() => undefined} /></div>;
}

export function RouteBankMap({ routes, vehicleTypes, selectedId, onSelect, onMove }: { routes: SavedRoute[]; vehicleTypes: VehicleType[]; selectedId: string | null; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const pointer = (event: React.PointerEvent<SVGSVGElement>) => { const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return { x: 50, y: 50 }; return { x: clamp((event.clientX - rect.left) / rect.width * 100, 5, 95), y: clamp((event.clientY - rect.top) / rect.height * 100, 8, 92) }; };
  return <svg ref={svgRef} className="v04-route-bank-map" viewBox="0 0 900 460" onPointerMove={(event) => { if (!dragId) return; const p = pointer(event); onMove(dragId, p.x, p.y); }} onPointerUp={() => setDragId(null)} onPointerLeave={() => setDragId(null)}>
    <defs><pattern id="route-bank-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" /></pattern></defs><rect width="900" height="460" /><rect width="900" height="460" fill="url(#route-bank-grid)" /><g className="v08-engineering-map" fill="none"><path d="M20 392 C180 310 300 420 450 322 S690 215 880 270" /><path d="M65 78 C220 125 355 110 510 62 S730 48 840 92" /></g>
    {routes.map((route) => { const type = vehicleTypes.find((item) => item.name === route.vehicleType); const x = (route.mapX ?? 50) / 100 * 900; const y = (route.mapY ?? 50) / 100 * 460; const color = type?.color ?? "#8396a4"; const rotation = route.rotationDeg ?? 0; const scale = (route.scalePct ?? 100) / 100; const local = route.family === "SI" ? null : route.routeKind === "double" ? doubleHippodromeLoop({ x: 0, y: 0 }, 0.29 * scale, 0) : route.routeKind === "figure8" ? figureEightLoop({ x: 0, y: 0 }, 55 * scale, 28 * scale, 0, 90) : stadiumLoop({ x: -58 * scale, y: 0 }, { x: 58 * scale, y: 0 }, 23 * scale, 84); return <g key={route.id} className={`v04-bank-route ${selectedId === route.id ? "selected" : ""}`} transform={`translate(${x} ${y}) rotate(${rotation})`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragId(route.id); onSelect(route.id); }} onClick={() => onSelect(route.id)}>{route.family === "SI" ? <><circle r={45 * scale} stroke={color} /><circle r={28 * scale} stroke={color} opacity=".5" /></> : <path d={closedPath(local ?? [])} stroke={color} className={route.routeKind === "double" ? "v08-continuous-double" : ""} />}<g transform={`rotate(${-rotation}) translate(0 ${65 * scale})`}><rect x="-62" y="-13" width="124" height="26" rx="13" /><text y="5" textAnchor="middle">{route.name}</text></g></g>; })}
  </svg>;
}
