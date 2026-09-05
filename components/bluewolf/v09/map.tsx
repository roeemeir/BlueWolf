"use client";

import type { SoRelation, VehicleType } from "@/lib/bluewolf";
import { getV09Scenario } from "./simulator";
import { pointOnClosed, scoreColor, svgClosedPath, type Point } from "./geometry";

export type V09GroupKey = "si" | "so";
export type OverlayKey = "trace" | "routes" | "hulls" | "relations" | "scoreTrace";

export const GROUP_COLORS: Record<V09GroupKey, string> = { si: "#14a89b", so: "#5d6ff4" };
export const TYPE_COLORS = ["#f59e0b", "#2563eb", "#8b5cf6"] as const;

export function fixedVehicleTypes(vehicleTypes: VehicleType[]) {
  return vehicleTypes.map((type, index) => ({ ...type, color: TYPE_COLORS[index % TYPE_COLORS.length] }));
}

function typeColor(vehicleTypes: VehicleType[], typeId: string) {
  const found = vehicleTypes.find((item) => item.id === typeId);
  if (found) return found.color;
  const index = ["storm", "lightning", "thunder"].indexOf(typeId);
  return TYPE_COLORS[index >= 0 ? index : 0];
}

function background(profile: string) {
  const engineering = profile.includes("engineering") || profile.includes("הנדסה");
  const ortho = profile.includes("ortho") || profile.includes("צילום");
  return <>
    <defs>
      <pattern id="v09-grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="rgba(100,130,155,.12)" /></pattern>
      <linearGradient id="v09-ortho" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--map-bg)" /><stop offset="1" stopColor="rgba(62,106,80,.14)" /></linearGradient>
    </defs>
    <rect width="1000" height="570" fill={ortho ? "url(#v09-ortho)" : "var(--map-bg)"} />
    {engineering && <rect width="1000" height="570" fill="url(#v09-grid)" />}
    <g className="v09-base-context" fill="none">
      <path d="M-20 475 C170 390 300 505 475 395 S760 268 1030 338" />
      <path d="M60 88 C245 158 355 121 505 68 S765 53 960 120" />
      <path d="M-30 232 C180 178 320 266 480 214 S770 158 1040 238" />
      <path d="M420 112h102v64H420zM808 404h120v76H808z" />
    </g>
  </>;
}

function VehicleArrow({ x, y, heading, color, id, selected, onClick }: { x: number; y: number; heading: number; color: string; id: number; selected: boolean; onClick: () => void }) {
  return <g className={`v09-vehicle ${selected ? "selected" : ""}`} transform={`translate(${x} ${y})`} role="button" tabIndex={0} onClick={onClick} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }} aria-label={`רכב ${id}`}>
    {selected && <circle r="19" fill="none" stroke={color} strokeWidth="3" opacity=".45" />}
    <g transform={`rotate(${heading})`}><circle r="13" fill="var(--map-card)" stroke={color} strokeWidth="2.5" /><path d="M0-16 8 10 0 6-8 10Z" fill={color} /></g>
    <g transform="translate(0 27)"><rect x="-18" y="-9" width="36" height="18" rx="9" className="v09-id-bg" /><text y="4" textAnchor="middle" className="v09-id-text">{id}</text></g>
  </g>;
}

function relationBadge(x: number, y: number, relation: SoRelation) {
  const label = relation === "same" ? "זהה" : relation === "opposite" ? "הפוך" : "מעורב";
  return <g transform={`translate(${x} ${y})`}><rect x="-34" y="-14" width="68" height="28" rx="14" className="v09-relation-bg" /><text y="4" textAnchor="middle" className="v09-relation-text">{label}</text></g>;
}

function traceScore(serverId: string, vehicleId: number, index: number, group: V09GroupKey) {
  const base = group === "si" ? 91 : 84;
  const serverPenalty = serverId === "2" ? 7 : serverId === "3" ? 13 : 0;
  return Math.max(20, Math.min(99, base - serverPenalty + 11 * Math.sin((vehicleId + index * 7) / 18)));
}

function routeByKey(routes: ReturnType<typeof getV09Scenario>["routes"], key: string) {
  return routes.find((route) => route.key === key) ?? routes[0];
}

export function V09LiveMap({ serverId, tick, baseMap, overlays, vehicleTypes, selectedGroup, selectedVehicle, siAngles, soRelations, onSelectGroup, onSelectVehicle, compact = false }: {
  serverId: string;
  tick: number;
  baseMap: string;
  overlays: Record<OverlayKey, boolean>;
  vehicleTypes: VehicleType[];
  selectedGroup: V09GroupKey;
  selectedVehicle: number | null;
  siAngles: number[];
  soRelations: SoRelation[];
  onSelectGroup: (group: V09GroupKey) => void;
  onSelectVehicle: (vehicle: number, group: V09GroupKey) => void;
  compact?: boolean;
}) {
  const types = fixedVehicleTypes(vehicleTypes);
  const scenario = getV09Scenario(serverId, tick);
  const positions = (["si", "so"] as V09GroupKey[]).flatMap((groupKey) => scenario.groups[groupKey].members.map((vehicle) => {
    const route = routeByKey(scenario.routes, vehicle.routeKey);
    const point = pointOnClosed(route.points, vehicle.phase);
    return { ...point, vehicle, groupKey, route };
  }));
  const siPositions = positions.filter((item) => item.groupKey === "si");
  const soPositions = positions.filter((item) => item.groupKey === "so");
  const hulls = serverId === "2"
    ? { si: "M75 125Q235 62 384 135L392 445Q235 510 78 438Z", so: "M452 125Q720 82 972 168L954 455Q720 520 448 430Z" }
    : { si: "M70 120Q235 64 396 130L400 444Q240 508 72 438Z", so: "M420 105Q690 42 986 118L995 440Q740 525 420 454Z" };

  return <svg className={`v09-live-map ${compact ? "compact" : ""}`} viewBox="0 0 1000 570" role="img" aria-label={`מפה חיה · ${scenario.title}`}>
    {background(baseMap)}
    <g className="v09-map-heading"><text x="32" y="36">{scenario.title}</text><text x="32" y="57">{scenario.subtitle}</text></g>
    {overlays.hulls && <g className="v09-hulls"><path d={hulls.si} fill="rgba(20,168,155,.045)" stroke={GROUP_COLORS.si} onClick={() => onSelectGroup("si")} /><path d={hulls.so} fill="rgba(93,111,244,.045)" stroke={GROUP_COLORS.so} onClick={() => onSelectGroup("so")} /></g>}
    {overlays.routes && <g className="v09-routes">{scenario.routes.map((route) => <path key={route.key} d={svgClosedPath(route.points)} fill="none" stroke={typeColor(types, route.typeId)} strokeWidth={route.kind === "double" ? 5.6 : 4.6} opacity=".92" />)}</g>}
    {overlays.trace && <g className="v09-trace-dots">{positions.flatMap((item) => Array.from({ length: 14 }, (_, index) => {
      const point = pointOnClosed(item.route.points, item.vehicle.phase - (index + 1) * 0.018);
      return <circle key={`trace-${item.vehicle.id}-${index}`} cx={point.x} cy={point.y} r="4.2" fill={typeColor(types, item.vehicle.typeId)} opacity={0.28 + index * 0.045} />;
    }))}</g>}
    {overlays.scoreTrace && <g className="v09-score-trace">{positions.flatMap((item) => Array.from({ length: 18 }, (_, index) => {
      const point = pointOnClosed(item.route.points, item.vehicle.phase - (index + 1) * 0.017);
      const score = traceScore(serverId, item.vehicle.id, index, item.groupKey);
      return <circle key={`score-${item.vehicle.id}-${index}`} cx={point.x} cy={point.y} r="5.25" fill={scoreColor(score)} stroke="var(--map-card)" strokeWidth="1.2" opacity=".94" />;
    }))}</g>}
    {overlays.relations && selectedGroup === "si" && <g className="v09-si-relations">{siPositions.flatMap((a, first) => siPositions.slice(first + 1).map((b) => {
      const ax = a.x - 235; const ay = a.y - 285; const bx = b.x - 235; const by = b.y - 285;
      const aa = Math.atan2(ay, ax); const bb = Math.atan2(by, bx); const raw = Math.abs(aa - bb) * 180 / Math.PI; const angle = Math.round(Math.min(raw, 360 - raw));
      const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2;
      return <g key={`${a.vehicle.id}-${b.vehicle.id}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><rect x={x - 23} y={y - 11} width="46" height="22" rx="11" /><text x={x} y={y + 4} textAnchor="middle">{angle}°</text></g>;
    }))}<text x="230" y="525" textAnchor="middle" className="v09-template-caption">Template: {siAngles.join("° · ")}°</text></g>}
    {overlays.relations && selectedGroup === "so" && <g>{soPositions.slice(0, -1).map((item, index) => { const next = soPositions[index + 1]; return <g key={index}>{relationBadge((item.x + next.x) / 2, (item.y + next.y) / 2 - 36, soRelations[index] ?? "same")}</g>; })}</g>}
    <g className="v09-vehicles">{positions.map((item) => <VehicleArrow key={item.vehicle.id} x={item.x} y={item.y} heading={item.heading} color={typeColor(types, item.vehicle.typeId)} id={item.vehicle.id} selected={selectedVehicle === item.vehicle.id} onClick={() => onSelectVehicle(item.vehicle.id, item.groupKey)} />)}</g>
    {overlays.scoreTrace && <g className="v09-score-legend" transform="translate(30 500)"><rect width="226" height="46" rx="15" /><circle cx="22" cy="18" r="6" fill="#22b986" /><text x="34" y="22">80–100</text><circle cx="94" cy="18" r="6" fill="#f3a31b" /><text x="106" y="22">50–79</text><circle cx="166" cy="18" r="6" fill="#e45f62" /><text x="178" y="22">0–49</text><text x="12" y="39">צבע נקודה = ציון באותו זמן</text></g>}
    <g className="v09-map-scale"><path d="M842 522h100" /><text x="842" y="511">100 מ׳</text></g>
  </svg>;
}

export function drawCanvasRoute(ctx: CanvasRenderingContext2D, points: Point[], color: string, width = 5) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
