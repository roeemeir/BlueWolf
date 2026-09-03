"use client";

import { LoaderCircle, MapPinned, Radar } from "lucide-react";

import {
  getServerScenario,
  scoreSeriesForServer,
  type DemoGroupKey,
  type Family,
  type VehicleIconName,
  type VehicleType,
} from "@/lib/bluewolf";
import { WolfLogo } from "./wolf-logo";

export type GroupKey = DemoGroupKey;
export type ScoreLayer = "total" | "sync" | "route";
export const DEMO_GROUPS = getServerScenario("1").groups;

export function LoadingScreen({ progress }: { progress: number }) {
  const stage = progress < 35 ? "טוען קונפיגורציה" : progress < 70 ? "מכין מנוע תנועה" : "מסנכרן סביבת עבודה";
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-aurora" />
      <div className="loading-orbit orbit-one" />
      <div className="loading-orbit orbit-two" />
      <div className="loading-card glass-panel">
        <div className="loading-logo-wrap"><WolfLogo animated /></div>
        <h1>זאב כחול</h1>
        <p>{stage}</p>
        <div className="loading-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="loading-meta"><span>{progress}%</span><span><LoaderCircle className="spin" /> מכין סביבת עבודה</span></div>
      </div>
    </div>
  );
}

export function ScoreRing({ value, color, size = "normal" }: { value: number; color: string; size?: "small" | "normal" | "large" }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`score-ring score-ring-${size}`} style={{ background: `conic-gradient(${color} ${safe * 3.6}deg, var(--score-track) 0deg)` }} aria-label={`ציון ${safe}`}>
      <div><strong>{safe}</strong>{size === "large" && <span>כולל</span>}</div>
    </div>
  );
}

export function VehicleIconGlyph({ icon, color = "currentColor" }: { icon: VehicleIconName; color?: string }) {
  if (icon === "truck") return <g stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M-8-5h10v10H-8zM2-2h5l3 3v4H2z" /><circle cx="-4" cy="7" r="2" /><circle cx="6" cy="7" r="2" /></g>;
  if (icon === "shield") return <g stroke={color} strokeWidth="1.8" fill="none" strokeLinejoin="round"><path d="M0-10 9-6v7c0 6-4 9-9 12-5-3-9-6-9-12v-7z" /><path d="m-4 0 3 3 5-7" /></g>;
  if (icon === "drone") return <g stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"><circle r="3" /><path d="m-3-3-6-5m12 5 6-5m-12 11-6 5m12-5 6 5" /><circle cx="-9" cy="-8" r="2" /><circle cx="9" cy="-8" r="2" /><circle cx="-9" cy="8" r="2" /><circle cx="9" cy="8" r="2" /></g>;
  if (icon === "boat") return <g stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M0-10V2M0-8l7 7H0M-9 3h18l-4 7H-5z" /></g>;
  return <g stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="-8" y="-7" width="16" height="14" rx="4" /><circle cx="-5" cy="8" r="2" /><circle cx="5" cy="8" r="2" /><path d="M-4-2h8M0-7v-4" /><circle cy="-12" r="1.5" fill={color} /></g>;
}

function VehicleMarker({ x, y, id, color, icon, selected, dimmed, animate = true, onClick }: { x: number; y: number; id: number; color: string; icon: VehicleIconName; selected?: boolean; dimmed?: boolean; animate?: boolean; onClick: () => void }) {
  return (
    <g className={`vehicle-marker ${selected ? "selected" : ""} ${dimmed ? "dimmed" : ""}`} style={{ transform: `translate(${x}px, ${y}px)`, transition: animate ? "transform 4.8s linear" : "none" }} onClick={onClick} role="button" tabIndex={0} aria-label={`רכב ${id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}>
      <circle className="vehicle-radar" r={selected ? 19 : 15} fill={color} />
      <circle className="vehicle-core" r="12" fill="var(--map-card)" stroke={color} strokeWidth="2.2" />
      <VehicleIconGlyph icon={icon} color={color} />
      <g className="vehicle-id-pill"><rect x="-18" y="-31" width="36" height="16" rx="8" /><text y="-20" textAnchor="middle">{id}</text></g>
    </g>
  );
}

const ringRadius: Record<string, number> = { inner: 47, middle: 78, outer: 110 };
const ringColor: Record<string, string> = { inner: "#ff9f43", middle: "#34b7eb", outer: "#9068ff" };

function rotatePoint(cx: number, cy: number, rx: number, ry: number, phase: number, rotation: number) {
  const angle = phase * Math.PI * 2;
  const localX = Math.cos(angle) * rx;
  const localY = Math.sin(angle) * ry;
  const r = rotation * Math.PI / 180;
  return { x: cx + localX * Math.cos(r) - localY * Math.sin(r), y: cy + localX * Math.sin(r) + localY * Math.cos(r) };
}

function soPoint(index: number, phase: number) {
  if (index === 0) return rotatePoint(546, 206, 57, 30, phase, -34);
  if (index === 3) return rotatePoint(842, 258, 55, 26, phase, 0);
  const p = (phase + (index === 2 ? .5 : 0)) % 1;
  if (p < .5) return rotatePoint(666, 185, 78, 34, p * 2, 8);
  return rotatePoint(680, 312, 82, 35, (p - .5) * 2, -8);
}

function PairRelations({ points, values }: { points: { x: number; y: number; id: number }[]; values: number[] }) {
  const pairs: [number, number][] = [];
  for (let first = 0; first < points.length; first += 1) for (let second = first + 1; second < points.length; second += 1) pairs.push([first, second]);
  return <g className="pair-relation-layer">{pairs.map(([a, b], index) => {
    const first = points[a]; const second = points[b];
    const mx = (first.x + second.x) / 2; const my = (first.y + second.y) / 2;
    const rawDifference = values.includes(0) && values[a] !== undefined && values[b] !== undefined ? Math.abs(values[a] - values[b]) : undefined;
    const value = rawDifference === undefined ? (values[index] ?? Math.round(Math.abs((a - b) * 120) % 360)) : Math.min(rawDifference, 360 - rawDifference);
    return <g key={`${first.id}-${second.id}`}><line x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><rect x={mx - 25} y={my - 10} width="50" height="19" rx="9" /><text x={mx} y={my + 4} textAnchor="middle">{value}°</text></g>;
  })}</g>;
}

export function LiveMap({
  serverId,
  tick,
  selectedGroup,
  selectedVehicle,
  showTrace,
  showRoutes,
  showRelations,
  showGrid,
  vehicleTypes,
  templateValues,
  mapProfile = "engineering",
  animate = true,
  onSelectGroup,
  onSelectVehicle,
}: {
  serverId: string;
  tick: number;
  selectedGroup: GroupKey;
  selectedVehicle: number | null;
  showTrace: boolean;
  showRoutes: boolean;
  showRelations: boolean;
  showGrid: boolean;
  vehicleTypes: VehicleType[];
  templateValues?: Partial<Record<GroupKey, number[]>>;
  mapProfile?: string;
  animate?: boolean;
  onSelectGroup: (key: GroupKey) => void;
  onSelectVehicle: (id: number, group: GroupKey) => void;
}) {
  const scenario = getServerScenario(serverId);
  const serverShift = (Number(serverId) - 1) * .05;
  const progress = (tick * .035 + serverShift) % 1;
  const typeById = (typeId: string) => vehicleTypes.find((type) => type.id === typeId) ?? vehicleTypes[0];
  const siPoints = scenario.groups.si.members.map((vehicle) => {
    const radius = ringRadius[vehicle.ring ?? "middle"];
    const angle = (progress + vehicle.phase) * Math.PI * 2;
    return { x: 242 + Math.cos(angle) * radius, y: 235 + Math.sin(angle) * radius, id: vehicle.id, vehicle };
  });
  const soPoints = scenario.groups.so.members.map((vehicle, index) => ({ ...soPoint(index, (progress + vehicle.phase) % 1), id: vehicle.id, vehicle }));
  const mapClass = mapProfile === "orthophoto" ? "orthophoto" : "engineering";

  return (
    <svg className={`map-svg ${mapClass}`} viewBox="0 0 940 470" role="img" aria-label={`מפת ${scenario.arena} בזמן אמת`}>
      <defs>
        <pattern id={`small-grid-${serverId}`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" className="map-grid-small" /></pattern>
        <pattern id={`large-grid-${serverId}`} width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill={`url(#small-grid-${serverId})`} /><path d="M120 0H0V120" className="map-grid-large" /></pattern>
        <linearGradient id={`mapWash-${serverId}`} x1="0" x2="1"><stop stopColor="var(--map-wash-a)" /><stop offset="1" stopColor="var(--map-wash-b)" /></linearGradient>
      </defs>
      <rect width="940" height="470" fill="var(--map-bg)" />
      <rect width="940" height="470" fill={`url(#mapWash-${serverId})`} />
      {showGrid && <rect width="940" height="470" fill={`url(#large-grid-${serverId})`} />}
      <g className="map-terrain"><path d="M0 83C176 30 283 151 438 101s267-58 502-11" /><path d="M0 397c158-76 286 18 427-43s310-55 513 17" /><path d="M462 0c-35 91 42 168-2 257s12 146-9 213" /></g>
      <g className="map-coordinates"><text x="34" y="38">31.800000°N</text><text x="770" y="445">34.800000°E</text><path d="M38 412h82" /><text x="38" y="402">100 מ׳</text></g>

      {showTrace && <g className="observed-traces">
        <path className="si" d="M132 235C132 120 349 111 352 235C350 357 134 355 132 235" />
        <path className="so" d="M490 242C473 205 497 164 536 150C574 137 612 155 616 190C622 226 584 252 548 260" />
        <path className="so" d="M597 184C608 135 699 129 750 164C786 191 761 232 720 235H642C602 239 594 202 597 184M602 315C605 273 653 266 697 281H752C790 284 794 329 757 347H665C626 358 598 341 602 315" />
        <path className="so" d="M788 258C790 219 826 208 872 225C912 239 908 282 876 294C833 309 791 296 788 258" />
      </g>}

      {showRoutes && <g className="estimated-routes">
        {(["inner", "middle", "outer"] as const).map((ring) => <circle key={ring} cx="242" cy="235" r={ringRadius[ring]} style={{ stroke: ringColor[ring] }} className={`si-route ${selectedGroup === "si" ? "active" : ""}`} onClick={() => onSelectGroup("si")} />)}
        <g className={`so-hierarchy ${selectedGroup === "so" ? "active" : ""}`} onClick={() => onSelectGroup("so")}>
          <path d="M490 242C473 205 497 164 536 150C574 137 612 155 616 190C622 226 584 252 548 260C511 269 486 260 490 242Z" />
          <path className="double" d="M596 184C604 139 670 126 724 149C775 171 774 216 728 232H649C615 240 592 216 596 184ZM603 316C607 279 649 266 694 280H750C793 281 803 322 769 345C737 362 690 347 656 353C619 358 597 342 603 316Z" />
          <path className="bridge" d="M649 232L694 280M728 232L750 280" />
          <path d="M788 258C790 219 826 208 872 225C912 239 908 282 876 294C833 309 791 296 788 258Z" />
          <path className="neighbor-link" d="M585 230L615 217M772 281L797 272" />
        </g>
      </g>}

      {showRelations && selectedGroup === "si" && <PairRelations points={siPoints} values={templateValues?.si ?? [120, 120, 120]} />}
      {showRelations && selectedGroup === "so" && <g className="so-relation-layer">
        <g><path d="M551 112L650 112" /><rect x="570" y="96" width="122" height="25" rx="12" /><text x="631" y="113" textAnchor="middle">הפוך · Δרבע 2</text></g>
        <g><path d="M704 390L842 390" /><rect x="719" y="374" width="128" height="25" rx="12" /><text x="783" y="391" textAnchor="middle">זהה · פניות יחד</text></g>
      </g>}

      <g className="map-vehicles">
        {siPoints.map(({ x, y, id, vehicle }) => { const type = typeById(vehicle.typeId); return <VehicleMarker key={id} x={x} y={y} id={id} color={type?.color ?? "#22cbb8"} icon={type?.icon ?? "rover"} selected={selectedVehicle === id} dimmed={selectedGroup !== "si"} animate={animate} onClick={() => onSelectVehicle(id, "si")} />; })}
        {soPoints.map(({ x, y, id, vehicle }) => { const type = typeById(vehicle.typeId); return <VehicleMarker key={id} x={x} y={y} id={id} color={type?.color ?? "#ff9f43"} icon={type?.icon ?? "truck"} selected={selectedVehicle === id} dimmed={selectedGroup !== "so"} animate={animate} onClick={() => onSelectVehicle(id, "so")} />; })}
      </g>
      <g className="map-family-label" onClick={() => onSelectGroup("si")}><rect x="159" y="209" width="166" height="52" rx="15" /><text x="242" y="231" textAnchor="middle">{scenario.groups.si.id} · טבעות</text><text x="242" y="250" textAnchor="middle" className="sub">כתום · כחול · סגול</text></g>
      <g className="map-family-label so-label" onClick={() => onSelectGroup("so")}><rect x="635" y="236" width="162" height="52" rx="15" /><text x="716" y="258" textAnchor="middle">{scenario.groups.so.id} · מבנה ח׳</text><text x="716" y="277" textAnchor="middle" className="sub">כפול במרכז · פניות יחד</text></g>
    </svg>
  );
}

export const layerColor: Record<ScoreLayer, string> = { total: "#8aa4ff", sync: "#22cbb8", route: "#ff9f43" };
export const groupLineColor: Record<GroupKey, string> = { si: "#24c9b6", so: "#ff9f43" };

export function TimelineChart({
  serverId,
  selected,
  layers,
  cursor,
  onCursor,
  selectedVehicle,
  fromLabel = "לפני שעה",
  toLabel = "עכשיו",
}: {
  serverId: string;
  selected: GroupKey;
  layers: ScoreLayer[];
  cursor: number;
  onCursor: (index: number) => void;
  selectedVehicle?: number | null;
  fromLabel?: string;
  toLabel?: string;
}) {
  const series = scoreSeriesForServer(serverId, 120);
  const top = 18; const bottom = 166;
  const x = (index: number) => 54 + (index / (series.length - 1)) * 908;
  const y = (score: number) => bottom - score / 100 * (bottom - top);
  const points = (group: GroupKey, layer: ScoreLayer) => series.map((item) => `${x(item.index)},${y(item[group][layer])}`).join(" ");
  const safeCursor = Math.max(0, Math.min(series.length - 1, cursor));
  const cursorItem = series[safeCursor][selected];
  const eventBoundaries = [31, 59, 82, 104];
  const vehicleOffset = selectedVehicle ? ((selectedVehicle % 7) - 3) * 1.7 : 0;

  return (
    <svg className="timeline-svg" viewBox="0 0 1000 248" role="img" aria-label="גרף ציוני שתי הקבוצות לאורך הזמן" onPointerDown={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const relative = (event.clientX - rect.left) / rect.width;
      onCursor(Math.round(Math.max(0, Math.min(1, relative)) * (series.length - 1)));
    }}>
      {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1="54" x2="962" y1={y(score)} y2={y(score)} className="chart-grid" /><text x="43" y={y(score) + 4} textAnchor="end" className="chart-label">{score}</text></g>)}
      <rect x="54" y={y(100)} width="908" height={y(80) - y(100)} className="score-zone good" /><rect x="54" y={y(80)} width="908" height={y(50) - y(80)} className="score-zone medium" /><rect x="54" y={y(50)} width="908" height={y(0) - y(50)} className="score-zone low" />
      {eventBoundaries.map((index, boundaryIndex) => <g className="event-boundary" key={index}><line x1={x(index)} x2={x(index)} y1={top} y2="220" /><text x={x(index) + 5} y="30">E{boundaryIndex + 1}</text></g>)}
      {(["si", "so"] as GroupKey[]).flatMap((group) => layers.map((layer) => <polyline key={`${group}-${layer}`} points={points(group, layer)} fill="none" stroke={group === "si" ? groupLineColor.si : groupLineColor.so} strokeWidth={layer === "sync" ? (group === selected ? 3.6 : 2.7) : 1.8} strokeDasharray={layer === "route" ? "8 5" : layer === "total" ? "2 3" : undefined} opacity={layer === "sync" ? 1 : .66} />))}
      {selectedVehicle && <polyline points={series.map((item) => `${x(item.index)},${y(Math.max(0, Math.min(100, item[selected].total + vehicleOffset + Math.sin(item.index / 5) * 2)))}`).join(" ")} fill="none" stroke="#c877ff" strokeWidth="2.2" strokeDasharray="5 4" />}
      <line x1={x(safeCursor)} x2={x(safeCursor)} y1={top} y2="220" className="cursor-line" /><circle cx={x(safeCursor)} cy={y(cursorItem.sync)} r="6" fill={groupLineColor[selected]} className="cursor-dot" />
      <g className="event-strip"><text x="45" y="191" textAnchor="end">SI</text><rect x="54" y="182" width="277" height="10" rx="5" className="good" /><rect x="335" y="182" width="250" height="10" rx="5" className="medium" /><rect x="589" y="182" width="373" height="10" rx="5" className="good" /><text x="45" y="208" textAnchor="end">SO</text><rect x="54" y="199" width="235" height="10" rx="5" className="good" /><rect x="293" y="199" width="329" height="10" rx="5" className="low" /><rect x="626" y="199" width="336" height="10" rx="5" className="medium" /></g>
      <text x="54" y="239" className="chart-label">{fromLabel}</text><text x="962" y="239" textAnchor="end" className="chart-label">{toLabel}</text>
      <g className="cursor-value"><rect x={Math.min(916, Math.max(58, x(safeCursor) - 25))} y="4" width="50" height="23" rx="10" /><text x={Math.min(941, Math.max(83, x(safeCursor)))} y="20" textAnchor="middle">{cursorItem.sync}</text></g>
    </svg>
  );
}

export function TemplatePreview({ family, values, compact = false, title }: { family: Family | GroupKey; values: number[]; compact?: boolean; title?: string }) {
  const normalized = family.toUpperCase() as Family;
  const angles = values.includes(0) ? values : [0, values[0] ?? 120, (values[0] ?? 120) + (values[1] ?? 120), ...values.slice(2).map((_, index) => (index + 3) * 60)];
  return (
    <svg className={`template-preview-svg ${compact ? "compact" : ""}`} viewBox="0 0 320 190" role="img" aria-label={title ?? `תצוגת תבנית ${normalized}`}>
      <rect width="320" height="190" rx="18" />
      {normalized === "SI" ? <g>
        <circle cx="160" cy="95" r="35" className="ring inner" /><circle cx="160" cy="95" r="58" className="ring middle" /><circle cx="160" cy="95" r="80" className="ring outer" />
        {angles.slice(0, Math.max(3, Math.min(5, angles.length))).map((angle, index) => { const radius = [35, 58, 80, 58, 80][index]; const radians = (angle - 90) * Math.PI / 180; const x = 160 + Math.cos(radians) * radius; const y = 95 + Math.sin(radians) * radius; return <g key={index}><line x1="160" y1="95" x2={x} y2={y} className="preview-spoke" /><circle cx={x} cy={y} r="8" fill={[ringColor.inner, ringColor.middle, ringColor.outer, ringColor.middle, ringColor.outer][index]} /><text x={x} y={y - 13} textAnchor="middle">{angle % 360}°</text></g>; })}
      </g> : <g className="preview-so">
        <path d="M24 80C20 49 55 36 86 48C111 59 107 90 82 99C53 110 27 101 24 80Z" />
        <path className="double" d="M105 62C112 35 157 31 190 46C218 59 215 84 190 94H143C116 99 100 85 105 62ZM109 127C113 105 142 98 169 106H208C234 109 235 135 212 146H151C128 151 106 145 109 127Z" />
        <path className="bridge" d="M143 94L169 106M190 94L208 106" />
        <path d="M235 103C237 78 265 72 294 84C315 93 311 119 293 128C264 139 237 128 235 103Z" />
        {[0, 1, 2].map((index) => <g key={index}><circle cx={[69, 162, 272][index]} cy={[75, 122, 103][index]} r="8" /><text x={[69, 162, 272][index]} y={[57, 104, 85][index]} textAnchor="middle">רבע {values[index] ?? 2}</text></g>)}
        <text x="160" y="177" textAnchor="middle">יחסי זהה/הפוך + פניות מתוזמנות</text>
      </g>}
    </svg>
  );
}

export function EventMiniMap({ family, color }: { family: GroupKey; color: string }) {
  return <div className="event-mini-map"><MapPinned /><span>{family.toUpperCase()}</span>{family === "si" ? <div className="mini-circle-route" style={{ borderColor: color }} /> : <div className="mini-so-route" style={{ borderColor: color }} />}</div>;
}

export function MapLoadingOverlay({ progress, label }: { progress: number; label: string }) {
  return <div className="map-loading-overlay"><div className="map-loader-radar"><Radar /><i /><i /><i /></div><strong>{label}</strong><span>{progress}%</span><div className="loading-track compact"><span style={{ width: `${progress}%` }} /></div></div>;
}
