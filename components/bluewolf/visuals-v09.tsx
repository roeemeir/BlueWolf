"use client";

import {
  SO_RELATION_LABELS,
  getServerScenario,
  relationFromCode,
  scoreSeriesForServer,
  type DemoGroupKey,
  type Family,
  type SoRelation,
  type SoRouteKind,
  type VehicleIconName,
  type VehicleType,
} from "@/lib/bluewolf";
import { LoadingScreen, ScoreRing, VehicleIconGlyph } from "./visuals-legacy";

export { LoadingScreen, ScoreRing, VehicleIconGlyph };
export type GroupKey = DemoGroupKey;
export type ScoreLayer = "total" | "sync" | "route";

export const groupLineColor: Record<GroupKey, string> = { si: "#1bb19f", so: "#5b78ef" };
export const fallbackTypeColors: Record<string, string> = {
  storm: "#ff9f43",
  lightning: "#34b7eb",
  thunder: "#9068ff",
};

type Point = { x: number; y: number };
type DirectedPoint = Point & { heading: number };
export type SoPreviewEntity = {
  id: string;
  kind: Exclude<SoRouteKind, "double-figure8">;
  vehicleTypeId: string;
  vehicleCount: number;
  stackGroup?: string;
};

const TAU = Math.PI * 2;
const ringRadius: Record<string, number> = { inner: 52, middle: 84, outer: 116 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function rotate(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

/** Correct stadium/hippodrome geometry.
 * Two parallel straight legs joined by OUTWARD semicircular turns.
 */
export function hippodromeLoop(center: Point, legLength: number, radius: number, rotationDeg = 0, count = 144): Point[] {
  const half = Math.max(0, legLength) / 2;
  const left = { x: center.x - half, y: center.y };
  const right = { x: center.x + half, y: center.y };
  const points: Point[] = [];
  const straightSamples = Math.max(8, Math.round(count * legLength / Math.max(1, 2 * legLength + 2 * Math.PI * radius)));
  const arcSamples = Math.max(16, Math.round((count - 2 * straightSamples) / 2));

  // Upper straight: left -> right.
  for (let i = 0; i < straightSamples; i += 1) {
    const t = i / straightSamples;
    points.push({ x: left.x + (right.x - left.x) * t, y: center.y - radius });
  }
  // Right turn: top -> bottom, bulging OUTWARD to +X.
  for (let i = 0; i < arcSamples; i += 1) {
    const theta = -Math.PI / 2 + i / arcSamples * Math.PI;
    points.push({ x: right.x + Math.cos(theta) * radius, y: right.y + Math.sin(theta) * radius });
  }
  // Lower straight: right -> left.
  for (let i = 0; i < straightSamples; i += 1) {
    const t = i / straightSamples;
    points.push({ x: right.x + (left.x - right.x) * t, y: center.y + radius });
  }
  // Left turn: bottom -> top, bulging OUTWARD to -X.
  for (let i = 0; i < arcSamples; i += 1) {
    const theta = Math.PI / 2 + i / arcSamples * Math.PI;
    points.push({ x: left.x + Math.cos(theta) * radius, y: left.y + Math.sin(theta) * radius });
  }
  return points.map((point) => rotate(point, center, rotationDeg));
}

function figureEightLoop(center: Point, legLength: number, radius: number, rotationDeg = 0, count = 180): Point[] {
  const points: Point[] = [];
  const sx = Math.max(radius * 2.2, legLength / 2 + radius);
  const sy = Math.max(radius * 1.35, 24);
  for (let index = 0; index < count; index += 1) {
    const t = index / count * TAU;
    const local = { x: center.x + sx * Math.sin(t), y: center.y + sy * Math.sin(2 * t) };
    points.push(rotate(local, center, rotationDeg));
  }
  return points;
}

/** Double SO = two proper hippodromes with a bent connection, matching the agreed sketch.
 * It is not a stretched circle and not two collinear capsules.
 */
export function doubleHippodromeGeometry(center: Point, scale = 1, rotationDeg = 0) {
  const leftCenter = rotate({ x: center.x - 70 * scale, y: center.y + 16 * scale }, center, rotationDeg);
  const rightCenter = rotate({ x: center.x + 70 * scale, y: center.y - 14 * scale }, center, rotationDeg);
  const leftRotation = rotationDeg - 24;
  const rightRotation = rotationDeg + 22;
  const radius = 25 * scale;
  const leg = 82 * scale;
  const left = hippodromeLoop(leftCenter, leg, radius, leftRotation, 112);
  const right = hippodromeLoop(rightCenter, leg, radius, rightRotation, 112);
  const leftJoin = pointOnClosed(left, 0.24);
  const rightJoin = pointOnClosed(right, 0.74);
  const connector: Point[] = Array.from({ length: 10 }, (_, i) => lerp(leftJoin, rightJoin, i / 9));
  const reverseConnector = [...connector].reverse();
  const traversal = [...left, ...connector, ...right, ...reverseConnector];
  return { left, right, connector, traversal, leftCenter, rightCenter };
}

function closedPath(points: Point[]) {
  if (!points.length) return "";
  return `M${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" L")} Z`;
}
function openPath(points: Point[]) {
  if (!points.length) return "";
  return `M${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" L")}`;
}

function pointOnClosed(points: Point[], phase: number): DirectedPoint {
  if (!points.length) return { x: 0, y: 0, heading: 0 };
  const normalized = ((phase % 1) + 1) % 1;
  const lengths = points.map((point, index) => dist(point, points[(index + 1) % points.length]));
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

function vehicleType(vehicleTypes: VehicleType[], id: string) {
  return vehicleTypes.find((type) => type.id === id) ?? vehicleTypes[0];
}
function vehicleColor(vehicleTypes: VehicleType[], id: string) {
  return vehicleType(vehicleTypes, id)?.color ?? fallbackTypeColors[id] ?? "#7f8c98";
}

function VehicleMarker({ point, id, color, icon, selected, onClick }: { point: DirectedPoint; id: number; color: string; icon: VehicleIconName; selected: boolean; onClick: () => void }) {
  return <g className={`v09-vehicle ${selected ? "selected" : ""}`} transform={`translate(${point.x} ${point.y})`} onClick={onClick} role="button" tabIndex={0} aria-label={`רכב ${id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}>
    {selected && <circle r="20" className="v09-selection-ring" stroke={color} />}
    <g transform={`rotate(${point.heading})`}>
      <circle r="13" fill="var(--map-card)" stroke={color} strokeWidth="2.6" />
      <path d="M0-17 8.5 10 0 6-8.5 10Z" fill={color} stroke="var(--map-card)" strokeWidth="1.6" />
      <g transform="scale(.44) translate(0 3)"><VehicleIconGlyph icon={icon} color="var(--map-card)" /></g>
    </g>
    <g className="v09-id-label" transform="translate(0 28)"><rect x="-18" y="-9" width="36" height="18" rx="9" /><text y="4" textAnchor="middle">{id}</text></g>
  </g>;
}

function RelationBadge({ x, y, relation }: { x: number; y: number; relation: SoRelation }) {
  return <g className="v09-relation"><rect x={x - 41} y={y - 14} width="82" height="28" rx="14" /><text x={x} y={y + 4} textAnchor="middle">{SO_RELATION_LABELS[relation]}</text></g>;
}

function MapSurface({ id, profile, showGrid }: { id: string; profile: string; showGrid: boolean }) {
  return <>
    <defs><pattern id={`grid-v09-${id}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v09-grid-line" /></pattern></defs>
    <rect width="1000" height="570" className={`v09-map-surface profile-${profile}`} />
    {profile === "engineering" && <g className="v09-base-engineering" fill="none">
      <path d="M18 468 C180 392 302 505 470 398 S760 270 982 330" />
      <path d="M62 94 C238 157 350 120 500 72 S760 56 954 120" />
      <path d="M-20 232 C170 183 320 264 470 217 S770 162 1030 234" />
      <path d="M420 110h98v62h-98zM804 402h118v75H804z" />
    </g>}
    {profile !== "engineering" && <g className="v09-base-alt" opacity=".55"><path d="M0 390 Q240 330 470 410 T1000 330" /><path d="M40 120 Q280 200 520 110 T960 145" /></g>}
    {showGrid && <rect width="1000" height="570" fill={`url(#grid-v09-${id})`} />}
  </>;
}

function scoreColor(score: number, green = 80, red = 50) {
  if (score >= green) return "#20b486";
  if (score < red) return "#e85d55";
  return "#f3a313";
}

function serverGeometry(serverId: string) {
  if (serverId === "2") {
    return {
      left: hippodromeLoop({ x: 500, y: 385 }, 105, 29, -42),
      double: doubleHippodromeGeometry({ x: 730, y: 270 }, .66, 7),
      right: hippodromeLoop({ x: 915, y: 168 }, 72, 26, 58),
      description: "join/leave + period drift",
    };
  }
  if (serverId === "3") {
    return {
      left: hippodromeLoop({ x: 505, y: 180 }, 82, 26, 18),
      double: doubleHippodromeGeometry({ x: 730, y: 315 }, .68, -18),
      right: hippodromeLoop({ x: 930, y: 390 }, 92, 27, -34),
      description: "disconnect + geometry transition",
    };
  }
  return {
    left: hippodromeLoop({ x: 500, y: 390 }, 96, 29, -42),
    double: doubleHippodromeGeometry({ x: 735, y: 270 }, .66, -7),
    right: hippodromeLoop({ x: 915, y: 168 }, 78, 27, 54),
    description: "baseline + SO turn timing",
  };
}

export function LiveMapV09({
  serverId,
  tick,
  selectedGroup,
  selectedVehicle,
  showTrace,
  showScoreTrace,
  showRoutes,
  showRelations,
  showGroups,
  showGrid,
  vehicleTypes,
  templateValues,
  mapProfile = "engineering",
  onSelectGroup,
  onSelectVehicle,
}: {
  serverId: string;
  tick: number;
  selectedGroup: GroupKey;
  selectedVehicle: number | null;
  showTrace: boolean;
  showScoreTrace: boolean;
  showRoutes: boolean;
  showRelations: boolean;
  showGroups: boolean;
  showGrid: boolean;
  vehicleTypes: VehicleType[];
  templateValues?: Partial<Record<GroupKey, number[]>>;
  mapProfile?: string;
  onSelectGroup: (key: GroupKey) => void;
  onSelectVehicle: (id: number, group: GroupKey) => void;
}) {
  const scenario = getServerScenario(serverId);
  const progress = ((tick * 0.026) + Number(serverId) * .037) % 1;
  const siCenter = serverId === "3" ? { x: 250, y: 285 } : { x: 235, y: 285 };
  const geometry = serverGeometry(serverId);
  const doubleTraversal = geometry.double.traversal;
  const soMembers = scenario.groups.so.members;
  const routeForIndex = (index: number) => index === 0 ? geometry.left : index === soMembers.length - 1 ? geometry.right : doubleTraversal;

  const visibleSoMembers = serverId === "2" && tick % 36 < 9 ? soMembers.slice(0, 3)
    : serverId === "3" && tick % 44 >= 18 && tick % 44 < 25 ? soMembers.filter((_, index) => index !== 2)
      : soMembers;

  const siPoints = scenario.groups.si.members.map((vehicle, index) => {
    const radius = ringRadius[vehicle.ring ?? "middle"];
    const drift = serverId === "2" ? Math.sin(tick / 6 + index) * .05 * index : 0;
    const angle = (progress + vehicle.phase + drift) * TAU;
    return { x: siCenter.x + Math.cos(angle) * radius, y: siCenter.y + Math.sin(angle) * radius, heading: angle * 180 / Math.PI + 180, vehicle };
  });
  const soPoints = visibleSoMembers.map((vehicle) => {
    const originalIndex = soMembers.findIndex((item) => item.id === vehicle.id);
    const route = routeForIndex(originalIndex);
    const incidentLag = serverId === "1" && originalIndex === soMembers.length - 1 ? .06 * Math.max(0, Math.sin(tick / 7)) : 0;
    return { ...pointOnClosed(route, progress + vehicle.phase + (originalIndex === 2 ? .5 : 0) - incidentLag), vehicle, originalIndex };
  });
  const relations = (templateValues?.so ?? [2, 0]).map(relationFromCode);

  const traceFor = (route: Point[], phase: number, color: string, scoreBase: number, key: string, period: number) => Array.from({ length: 13 }, (_, index) => {
    const p = pointOnClosed(route, phase - (index + 1) * 5 / period);
    const sampleScore = clamp(Math.round(scoreBase + Math.sin((tick - index * 2) / 5) * 12), 0, 100);
    return <circle key={`${key}-${index}`} cx={p.x} cy={p.y} r={showScoreTrace ? 4.8 : 4.2} fill={showScoreTrace ? scoreColor(sampleScore) : color} opacity={.42 + index * .04} stroke="var(--map-card)" strokeWidth=".7" />;
  });

  return <svg className="map-svg v04-live-map v09-live-map" viewBox="0 0 1000 570" role="img" aria-label="מפה חיה של קבוצות SI ו-SO">
    <MapSurface id={serverId} profile={mapProfile} showGrid={showGrid} />
    <g className="v09-map-labels"><text x="38" y="42">SI · טבעות</text><text x="455" y="42">SO · שרשרת היפודרומים</text><text x="455" y="65">{geometry.description}</text></g>
    {showGroups && <g className="v09-group-hulls">
      <circle cx={siCenter.x} cy={siCenter.y} r="148" fill="rgba(27,177,159,.045)" stroke={groupLineColor.si} strokeWidth="2" strokeDasharray="8 8" />
      <path d="M420 480 Q610 548 982 414 Q1020 226 945 92 Q740 46 500 160 Q426 275 420 480Z" fill="rgba(91,120,239,.045)" stroke={groupLineColor.so} strokeWidth="2" strokeDasharray="8 8" />
    </g>}
    {showRoutes && <g className="v09-routes">
      <g onClick={() => onSelectGroup("si")} className={selectedGroup === "si" ? "active" : ""}>
        {(["inner", "middle", "outer"] as const).map((ring, index) => {
          const member = scenario.groups.si.members[index] ?? scenario.groups.si.members[0];
          return <circle key={ring} cx={siCenter.x} cy={siCenter.y} r={ringRadius[ring]} fill="none" stroke={vehicleColor(vehicleTypes, member?.typeId ?? "storm")} strokeWidth="4" opacity=".75" />;
        })}
      </g>
      <g onClick={() => onSelectGroup("so")} className={selectedGroup === "so" ? "active" : ""}>
        <path d={closedPath(geometry.left)} fill="none" stroke={vehicleColor(vehicleTypes, soMembers[0]?.typeId ?? "storm")} strokeWidth="4.5" />
        <path d={closedPath(geometry.double.left)} fill="none" stroke={vehicleColor(vehicleTypes, soMembers[1]?.typeId ?? "lightning")} strokeWidth="4.5" />
        <path d={closedPath(geometry.double.right)} fill="none" stroke={vehicleColor(vehicleTypes, soMembers[2]?.typeId ?? "lightning")} strokeWidth="4.5" />
        <path d={openPath(geometry.double.connector)} fill="none" stroke={vehicleColor(vehicleTypes, soMembers[1]?.typeId ?? "lightning")} strokeWidth="4.5" strokeLinecap="round" />
        <path d={closedPath(geometry.right)} fill="none" stroke={vehicleColor(vehicleTypes, soMembers.at(-1)?.typeId ?? "thunder")} strokeWidth="4.5" />
      </g>
    </g>}
    {(showTrace || showScoreTrace) && <g className="v09-traces">
      {siPoints.flatMap((item) => {
        const route = Array.from({ length: 140 }, (_, index) => {
          const angle = index / 140 * TAU;
          const radius = ringRadius[item.vehicle.ring ?? "middle"];
          return { x: siCenter.x + Math.cos(angle) * radius, y: siCenter.y + Math.sin(angle) * radius };
        });
        return traceFor(route, progress + item.vehicle.phase, groupLineColor.si, item.vehicle.score, `si-${item.vehicle.id}`, 46);
      })}
      {soPoints.flatMap((item) => traceFor(routeForIndex(item.originalIndex), progress + item.vehicle.phase + (item.originalIndex === 2 ? .5 : 0), groupLineColor.so, item.vehicle.score, `so-${item.vehicle.id}`, 74))}
    </g>}
    {showScoreTrace && <g className="v09-score-scale" transform="translate(760 520)"><rect width="190" height="28" rx="14" /><circle cx="20" cy="14" r="5" fill="#20b486"/><text x="32" y="18">80+</text><circle cx="82" cy="14" r="5" fill="#f3a313"/><text x="94" y="18">50–79</text><circle cx="157" cy="14" r="5" fill="#e85d55"/><text x="169" y="18">&lt;50</text></g>}
    {showRelations && selectedGroup === "si" && <g className="v09-si-relations">{siPoints.flatMap((a, first) => siPoints.slice(first + 1).map((b) => {
      const aa = Math.atan2(a.y - siCenter.y, a.x - siCenter.x);
      const bb = Math.atan2(b.y - siCenter.y, b.x - siCenter.x);
      const raw = Math.abs((aa - bb) * 180 / Math.PI) % 360;
      const angle = Math.round(Math.min(raw, 360 - raw));
      const mid = lerp(a, b, .5);
      return <g key={`${a.vehicle.id}-${b.vehicle.id}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><rect x={mid.x - 22} y={mid.y - 11} width="44" height="22" rx="11"/><text x={mid.x} y={mid.y + 4} textAnchor="middle">{angle}°</text></g>;
    }))}</g>}
    {showRelations && selectedGroup === "so" && <g><RelationBadge x={590} y={245} relation={relations[0] ?? "opposite"}/><RelationBadge x={885} y={320} relation={relations[1] ?? "same"}/></g>}
    <g className="v09-vehicles">
      {siPoints.map((item) => { const type = vehicleType(vehicleTypes, item.vehicle.typeId); const color = vehicleColor(vehicleTypes, item.vehicle.typeId); return <VehicleMarker key={item.vehicle.id} point={item} id={item.vehicle.id} color={color} icon={type?.icon ?? "rover"} selected={selectedVehicle === item.vehicle.id} onClick={() => onSelectVehicle(item.vehicle.id, "si")}/>; })}
      {soPoints.map((item) => { const type = vehicleType(vehicleTypes, item.vehicle.typeId); const color = vehicleColor(vehicleTypes, item.vehicle.typeId); return <VehicleMarker key={item.vehicle.id} point={item} id={item.vehicle.id} color={color} icon={type?.icon ?? "rover"} selected={selectedVehicle === item.vehicle.id} onClick={() => onSelectVehicle(item.vehicle.id, "so")}/>; })}
    </g>
    <g className="v09-map-scale"><path d="M42 520h90"/><text x="42" y="510">100 מ׳</text><text x="955" y="535" textAnchor="end">LIVE</text></g>
  </svg>;
}

function minutesLabel(totalMinutes: number) {
  const base = 17 * 60;
  const value = base + totalMinutes;
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function TimelineChartV09({ serverId = "1", windowMinutes, layers, cursor, onCursor, selectedVehicle }: { serverId?: string; windowMinutes: 30 | 60 | 90 | 120; layers: ScoreLayer[]; cursor: number; onCursor: (value: number) => void; selectedVehicle?: number | null }) {
  const full = scoreSeriesForServer(serverId, 120);
  const startIndex = Math.max(0, full.length - windowMinutes);
  const series = full.slice(startIndex);
  const left = 56; const right = 960; const top = 22; const bottom = 205;
  const safe = clamp(cursor - startIndex, 0, Math.max(0, series.length - 1));
  const x = (index: number) => left + index / Math.max(1, series.length - 1) * (right - left);
  const y = (score: number) => bottom - score / 100 * (bottom - top);
  const styles: Record<ScoreLayer, { width: number; dash?: string; label: string }> = {
    total: { width: 4.1, label: "כולל" },
    sync: { width: 2.5, dash: "10 6", label: "סנכרון" },
    route: { width: 2.3, dash: "2 7", label: "נתיב" },
  };
  const points = (group: GroupKey, layer: ScoreLayer) => series.map((item, index) => `${x(index)},${y(item[group][layer])}`).join(" ");
  return <svg className="timeline-svg v09-timeline" viewBox="0 0 1000 300" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const relative = clamp((event.clientX - rect.left) / rect.width, 0, 1); onCursor(startIndex + Math.round(relative * Math.max(0, series.length - 1))); }}>
    {[0,25,50,75,100].map((score) => <g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="chart-grid"/><text x="45" y={y(score)+4} textAnchor="end" className="chart-label">{score}</text></g>)}
    {layers.flatMap((layer) => (["si","so"] as GroupKey[]).map((group) => <polyline key={`${group}-${layer}`} points={points(group,layer)} fill="none" stroke={groupLineColor[group]} strokeWidth={styles[layer].width} strokeDasharray={styles[layer].dash} opacity=".95"/>))}
    <line x1={x(safe)} x2={x(safe)} y1={top} y2={bottom} className="cursor-line"/>
    {selectedVehicle && <text x="958" y="18" textAnchor="end" className="chart-label">רכב {selectedVehicle}</text>}
    <g className="v09-timeline-legend" transform="translate(58 232)">
      <circle cx="8" cy="8" r="6" fill={groupLineColor.si}/><text x="20" y="12">SI</text>
      <circle cx="78" cy="8" r="6" fill={groupLineColor.so}/><text x="90" y="12">SO</text>
      {layers.map((layer,index) => <g key={layer} transform={`translate(${160 + index*120} 0)`}><line x1="0" y1="8" x2="30" y2="8" stroke="currentColor" strokeWidth={styles[layer].width} strokeDasharray={styles[layer].dash}/><text x="38" y="12">{styles[layer].label}</text></g>)}
    </g>
    <text x={left} y="282" className="chart-label">{minutesLabel(120-windowMinutes)}</text><text x={right} y="282" textAnchor="end" className="chart-label">{minutesLabel(120)}</text>
  </svg>;
}

function siPreview(values: number[], typeColors: string[]) {
  const count = clamp(values.length + 1, 2, 8);
  const angles = [0];
  values.slice(0,count-1).forEach((value) => angles.push((angles.at(-1) ?? 0) + value));
  const points = angles.map((angle,index) => { const radius = [86,64,86,64,86,64,86,64][index]; const rad=(angle-90)*Math.PI/180; return { x:200+Math.cos(rad)*radius, y:120+Math.sin(rad)*radius }; });
  return <><circle cx="200" cy="120" r="42" className="ring inner"/><circle cx="200" cy="120" r="64" className="ring middle"/><circle cx="200" cy="120" r="86" className="ring outer"/>{points.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="9" fill={typeColors[i%typeColors.length]}/><text x={p.x} y={p.y-14} textAnchor="middle">R{i+1}</text></g>)}{values.slice(0,count-1).map((v,i)=>{const a=points[i],b=points[i+1],m=lerp(a,b,.5);return <g className="v09-preview-pair" key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><rect x={m.x-23} y={m.y-11} width="46" height="22" rx="11"/><text x={m.x} y={m.y+4} textAnchor="middle">{v}°</text></g>})}</>;
}

function entityGeometry(entity: SoPreviewEntity, center: Point, rotation: number, stackIndex: number) {
  const offset = stackIndex * 8;
  if (entity.kind === "double") return { double: doubleHippodromeGeometry(center, .24 + stackIndex*.018, rotation), loop: null as Point[] | null };
  if (entity.kind === "figure8") return { double: null, loop: figureEightLoop(center, 78+offset, 17+stackIndex*2, rotation, 96) };
  return { double: null, loop: hippodromeLoop(center, 78+offset, 17+stackIndex*2, rotation, 92) };
}

export function TemplatePreviewV09({ family, values, vehicleTypes, entities = [], compact = false }: { family: Family | GroupKey; values: number[]; vehicleTypes: VehicleType[]; entities?: SoPreviewEntity[]; compact?: boolean }) {
  const normalized = family.toUpperCase() as Family;
  const typeColors = vehicleTypes.length ? vehicleTypes.map((item)=>item.color) : Object.values(fallbackTypeColors);
  if (normalized === "SI") return <svg className={`template-preview-svg v09-template-preview ${compact?"compact":""}`} viewBox="0 0 400 240"><rect width="400" height="240" rx="20"/>{siPreview(values,typeColors)}</svg>;
  const effective = entities.length ? entities : [
    { id:"a", kind:"single", vehicleTypeId:vehicleTypes[0]?.id??"storm", vehicleCount:1 },
    { id:"b", kind:"double", vehicleTypeId:vehicleTypes[1]?.id??"lightning", vehicleCount:2 },
    { id:"c", kind:"single", vehicleTypeId:vehicleTypes[2]?.id??"thunder", vehicleCount:1 },
  ] satisfies SoPreviewEntity[];
  const relations = values.map(relationFromCode);
  const stackCounts = new Map<string,number>();
  const centers = effective.map((entity,index)=>{
    const key=entity.stackGroup;
    if(key){const first=effective.findIndex((e)=>e.stackGroup===key);return {x:90+first*100,y:125};}
    return {x:70+index*(260/Math.max(1,effective.length-1)),y:125+22*Math.sin(index*1.2)};
  });
  return <svg className={`template-preview-svg v09-template-preview ${compact?"compact":""}`} viewBox="0 0 400 240"><rect width="400" height="240" rx="20"/><g className="v09-preview-so">{effective.map((entity,index)=>{
    const stackKey=entity.stackGroup??`solo-${index}`;const stackIndex=stackCounts.get(stackKey)??0;stackCounts.set(stackKey,stackIndex+1);
    const rotation=[-28,-10,18,34][index%4];const geometry=entityGeometry(entity,centers[index],rotation,stackIndex);const color=vehicleColor(vehicleTypes,entity.vehicleTypeId);const relationBefore=relations[Math.max(0,index-1)]??"same";const basePhases=relationBefore==="opposite"?[.15,.65]:relationBefore==="mixed"?[.15,.40,.65,.90]:[.15,.20,.25,.30];
    const loop=geometry.loop??geometry.double?.traversal??[];
    return <g key={entity.id}>{geometry.loop && <path d={closedPath(geometry.loop)} stroke={color}/>} {geometry.double && <><path d={closedPath(geometry.double.left)} stroke={color}/><path d={closedPath(geometry.double.right)} stroke={color}/><path d={openPath(geometry.double.connector)} stroke={color}/></>}{Array.from({length:Math.max(1,entity.vehicleCount)},(_,v)=>{const p=pointOnClosed(loop,basePhases[v%basePhases.length]);return <g key={v} transform={`translate(${p.x} ${p.y}) rotate(${p.heading})`}><circle r="7" fill={color}/><path d="M0-9 5 6 0 3-5 6Z" fill="var(--map-card)"/></g>})}</g>;
  })}{effective.slice(0,-1).map((entity,index)=>{const a=centers[index],b=centers[index+1],m=lerp(a,b,.5);return <RelationBadge key={index} x={m.x} y={Math.min(a.y,b.y)-45} relation={relations[index]??"same"}/>})}</g></svg>;
}

export function ThresholdDiagram({ full, zero, unit }: { full: number; zero: number; unit: string }) {
  const max = Math.max(zero*1.15,1);
  const x = (v:number)=>18+v/max*184;
  return <svg className="v09-threshold-diagram" viewBox="0 0 220 78" role="img" aria-label={`100 עד ${full}${unit}, אפס מ-${zero}${unit}`}><line x1="18" y1="62" x2="204" y2="62"/><path d={`M18 16 H${x(full)} L${x(zero)} 62 H204`} fill="none" stroke="var(--primary)" strokeWidth="3"/><line x1={x(full)} y1="12" x2={x(full)} y2="66" stroke="#20b486" strokeDasharray="3 3"/><line x1={x(zero)} y1="12" x2={x(zero)} y2="66" stroke="#e85d55" strokeDasharray="3 3"/><text x={x(full)} y="75" textAnchor="middle">{full}{unit}</text><text x={x(zero)} y="75" textAnchor="middle">{zero}{unit}</text><text x="22" y="12">100</text><text x="204" y="58" textAnchor="end">0</text></svg>;
}

export function GtPlaybackV09({ family, progress, clipStart, clipEnd, vehicleTypes, serverId }: { family: Family; progress: number; clipStart: number; clipEnd: number; vehicleTypes: VehicleType[]; serverId: string }) {
  const tick=Math.round(progress*120);const dimBefore=Math.max(0,clipStart/100),dimAfter=Math.min(1,clipEnd/100);
  return <div className="v09-gt-playback"><LiveMapV09 serverId={serverId} tick={tick} selectedGroup={family.toLowerCase() as GroupKey} selectedVehicle={null} showTrace showScoreTrace={false} showRoutes showRelations showGroups showGrid={false} vehicleTypes={vehicleTypes} mapProfile="engineering" onSelectGroup={()=>undefined} onSelectVehicle={()=>undefined}/><div className="v09-clip-mask left" style={{width:`${dimBefore*100}%`}}/><div className="v09-clip-mask right" style={{width:`${(1-dimAfter)*100}%`}}/><div className="v09-clip-boundary start" style={{left:`${dimBefore*100}%`}}/><div className="v09-clip-boundary end" style={{left:`${dimAfter*100}%`}}/></div>;
}
