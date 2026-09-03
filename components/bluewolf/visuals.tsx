"use client";

import { LoaderCircle, MapPinned, Radar } from "lucide-react";

import { SCORE_SERIES } from "@/lib/bluewolf";
import { WolfLogo } from "./wolf-logo";

export type GroupKey = "si" | "so";
export type ScoreLayer = "total" | "sync" | "route";

export const DEMO_GROUPS = {
  si: {
    id: "SI-01",
    name: "קבוצה SI-01",
    family: "SI · שלוש טבעות",
    total: 86,
    sync: 89,
    route: 78,
    confidence: 94,
    color: "var(--si)",
    colorHex: "#22cbb8",
    members: [101, 102, 103],
    template: "חלוקה שווה 120° / 120°",
    reason: "התאמה טובה לחוקיות הזוויות",
  },
  so: {
    id: "SO-02",
    name: "קבוצה SO-02",
    family: "SO · שלושה היפודרומים",
    total: 63,
    sync: 57,
    route: 82,
    confidence: 91,
    color: "var(--so)",
    colorHex: "#ff9f43",
    members: [211, 212, 213],
    template: "הפוך · רבעים נגדיים",
    reason: "רכב 212 נכנס לפנייה באיחור",
  },
} as const;

export function LoadingScreen({ progress }: { progress: number }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-aurora" />
      <div className="loading-card glass-panel">
        <div className="loading-logo-wrap"><WolfLogo animated /></div>
        <h1>זאב כחול</h1>
        <p>טוען מנוע ניטור, תבניות ונתיבים</p>
        <div className="loading-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="loading-meta"><span>{progress}%</span><span><LoaderCircle className="spin" /> מכין סביבת עבודה</span></div>
      </div>
    </div>
  );
}

export function ScoreRing({ value, color, size = "normal" }: { value: number; color: string; size?: "small" | "normal" | "large" }) {
  return (
    <div className={`score-ring score-ring-${size}`} style={{ background: `conic-gradient(${color} ${Math.max(0, Math.min(100, value)) * 3.6}deg, var(--score-track) 0deg)` }} aria-label={`ציון ${value}`}>
      <div><strong>{value}</strong>{size === "large" && <span>כולל</span>}</div>
    </div>
  );
}

function VehicleMarker({ x, y, id, color, selected, dimmed, onClick }: { x: number; y: number; id: number; color: string; selected?: boolean; dimmed?: boolean; onClick: () => void }) {
  return (
    <g className={`vehicle-marker ${selected ? "selected" : ""} ${dimmed ? "dimmed" : ""}`} onClick={onClick} role="button" tabIndex={0} aria-label={`רכב ${id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}>
      <circle className="vehicle-radar" cx={x} cy={y} r={selected ? 17 : 13} fill={color} />
      <circle className="vehicle-core" cx={x} cy={y} r="8" fill={color} />
      <path d={`M${x} ${y - 11}l-4 6h8z`} fill="var(--map-bg)" />
      <text x={x} y={y - 18} textAnchor="middle" className="vehicle-label">{id}</text>
    </g>
  );
}

export function LiveMap({
  tick,
  selectedGroup,
  selectedVehicle,
  showTrace,
  showRoutes,
  showRelations,
  showGrid,
  onSelectGroup,
  onSelectVehicle,
}: {
  tick: number;
  selectedGroup: GroupKey;
  selectedVehicle: number | null;
  showTrace: boolean;
  showRoutes: boolean;
  showRelations: boolean;
  showGrid: boolean;
  onSelectGroup: (key: GroupKey) => void;
  onSelectVehicle: (id: number, group: GroupKey) => void;
}) {
  const angle = tick * .043;
  const siVehicles = [
    { radius: 54, phase: 0, id: 101 },
    { radius: 83, phase: 2 * Math.PI / 3, id: 102 },
    { radius: 112, phase: 4 * Math.PI / 3, id: 103 },
  ];
  const soVehicles = [
    { x: 603 + Math.sin(angle) * 38, y: 177, id: 211 },
    { x: 760 - Math.sin(angle + .4) * 46, y: 192, id: 212 },
    { x: 690 + Math.sin(angle + 2) * 55, y: 321, id: 213 },
  ];

  return (
    <svg className="map-svg" viewBox="0 0 920 470" role="img" aria-label="מפת קבוצות ונתיבים בזמן אמת">
      <defs>
        <pattern id="small-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" className="map-grid-small" /></pattern>
        <pattern id="large-grid" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="url(#small-grid)" /><path d="M120 0H0V120" className="map-grid-large" /></pattern>
        <filter id="marker-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <linearGradient id="mapWash" x1="0" x2="1"><stop stopColor="var(--map-wash-a)" /><stop offset="1" stopColor="var(--map-wash-b)" /></linearGradient>
      </defs>
      <rect width="920" height="470" fill="var(--map-bg)" />
      <rect width="920" height="470" fill="url(#mapWash)" />
      {showGrid && <rect width="920" height="470" fill="url(#large-grid)" />}
      <g className="map-terrain"><path d="M0 88C170 34 266 151 418 104s252-61 502-15" /><path d="M0 390c163-74 277 20 422-40s300-57 498 17" /><path d="M463 0c-38 92 44 167-3 258s8 145-12 212" /></g>
      <g className="map-coordinates"><text x="34" y="38">31.800000°N</text><text x="754" y="444">34.800000°E</text><path d="M38 412h82" /><text x="38" y="402">100 מ׳</text></g>

      {showTrace && <g className="observed-traces"><path className="si" d="M84 250C138 68 351 67 409 247C350 427 136 417 84 250" /><path className="so" d="M535 175C535 112 610 104 667 139H783C846 139 852 224 790 229H668C606 248 534 232 535 175" /><path className="so" d="M545 316C545 270 602 257 654 282H794C844 282 851 347 798 358H652C601 376 542 361 545 316" /></g>}

      {showRoutes && <g className="estimated-routes">
        {[54, 83, 112].map((radius) => <circle key={radius} cx="247" cy="244" r={radius} className={`si-route ${selectedGroup === "si" ? "active" : ""}`} onClick={() => onSelectGroup("si")} />)}
        <path className={`so-route ${selectedGroup === "so" ? "active" : ""}`} onClick={() => onSelectGroup("so")} d="M560 183C560 142 610 129 658 154H787C826 154 833 211 789 214H658C609 234 560 221 560 183Z" />
        <path className={`so-route ${selectedGroup === "so" ? "active" : ""}`} onClick={() => onSelectGroup("so")} d="M566 319C566 287 608 277 650 297H792C828 297 834 337 795 343H650C608 357 566 347 566 319Z" />
      </g>}

      {showRelations && <g className="relation-layer">
        <path d="M196 208A66 66 0 0 1 288 198" className="relation-si" /><text x="247" y="181" textAnchor="middle">120°</text>
        <path d="M653 259h140" className="relation-so" /><text x="723" y="249" textAnchor="middle">הפוך · פניות יחד</text>
      </g>}

      <g filter="url(#marker-glow)">
        {siVehicles.map((vehicle) => <VehicleMarker key={vehicle.id} x={247 + Math.cos(angle + vehicle.phase) * vehicle.radius} y={244 + Math.sin(angle + vehicle.phase) * vehicle.radius} id={vehicle.id} color="#22cbb8" selected={selectedVehicle === vehicle.id} dimmed={selectedGroup !== "si"} onClick={() => onSelectVehicle(vehicle.id, "si")} />)}
        {soVehicles.map((vehicle) => <VehicleMarker key={vehicle.id} {...vehicle} color="#ff9f43" selected={selectedVehicle === vehicle.id} dimmed={selectedGroup !== "so"} onClick={() => onSelectVehicle(vehicle.id, "so")} />)}
      </g>
      <g className="map-family-label" onClick={() => onSelectGroup("si")}><rect x="160" y="215" width="174" height="55" rx="15" /><text x="247" y="238" textAnchor="middle">SI · טבעות משותפות</text><text x="247" y="257" textAnchor="middle" className="sub">120° · 120°</text></g>
      <g className="map-family-label" onClick={() => onSelectGroup("so")}><rect x="650" y="222" width="150" height="55" rx="15" /><text x="725" y="245" textAnchor="middle">SO · הפוך</text><text x="725" y="264" textAnchor="middle" className="sub">פניות מתוזמנות</text></g>
    </svg>
  );
}

const layerColor: Record<ScoreLayer, string> = { total: "#8aa4ff", sync: "#22cbb8", route: "#ff9f43" };

export function TimelineChart({ selected, layers, cursor, onCursor, selectedVehicle }: { selected: GroupKey; layers: ScoreLayer[]; cursor: number; onCursor: (index: number) => void; selectedVehicle?: number | null }) {
  const top = 16;
  const bottom = 166;
  const x = (index: number) => 48 + (index / 59) * 920;
  const y = (score: number) => bottom - score / 100 * (bottom - top);
  const points = (layer: ScoreLayer) => SCORE_SERIES.map((item) => `${x(item.index)},${y(item[selected][layer])}`).join(" ");
  const cursorItem = SCORE_SERIES[Math.max(0, Math.min(59, cursor))][selected];
  const vehicleOffset = selectedVehicle ? ((selectedVehicle % 7) - 3) * 1.6 : 0;
  return (
    <svg className="timeline-svg" viewBox="0 0 1000 212" role="img" aria-label="גרף ציוני הקבוצה בשעה האחרונה" onPointerDown={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const relative = (event.clientX - rect.left) / rect.width;
      onCursor(Math.round(Math.max(0, Math.min(1, relative)) * 59));
    }}>
      {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1="48" x2="968" y1={y(score)} y2={y(score)} className="chart-grid" /><text x="36" y={y(score) + 4} textAnchor="end" className="chart-label">{score}</text></g>)}
      <rect x="48" y={y(100)} width="920" height={y(80) - y(100)} className="score-zone good" /><rect x="48" y={y(80)} width="920" height={y(50) - y(80)} className="score-zone medium" /><rect x="48" y={y(50)} width="920" height={y(0) - y(50)} className="score-zone low" />
      {layers.map((layer) => <polyline key={layer} points={points(layer)} fill="none" stroke={layerColor[layer]} strokeWidth={layer === "total" ? 3.3 : 2.1} opacity={layer === "total" ? 1 : .76} />)}
      {selectedVehicle && <polyline points={SCORE_SERIES.map((item) => `${x(item.index)},${y(Math.max(0, Math.min(100, item[selected].total + vehicleOffset + Math.sin(item.index / 3) * 2)))}`).join(" ")} fill="none" stroke="#c37bff" strokeWidth="1.8" strokeDasharray="5 4" />}
      <line x1={x(cursor)} x2={x(cursor)} y1={top} y2={bottom} className="cursor-line" /><circle cx={x(cursor)} cy={y(cursorItem.total)} r="6" fill={DEMO_GROUPS[selected].colorHex} className="cursor-dot" />
      <g className="event-strip"><rect x="48" y="181" width="380" height="10" rx="5" className="good" /><rect x="432" y="181" width="185" height="10" rx="5" className="medium" /><rect x="621" y="181" width="110" height="10" rx="5" className="low" /><rect x="735" y="181" width="233" height="10" rx="5" className="good" /></g>
      <text x="48" y="208" className="chart-label">לפני שעה</text><text x="968" y="208" textAnchor="end" className="chart-label">עכשיו</text><text x={Math.min(922, Math.max(76, x(cursor)))} y="29" textAnchor="middle" className="cursor-label">{cursorItem.total}</text>
    </svg>
  );
}

export function EventMiniMap({ family, color }: { family: GroupKey; color: string }) {
  return (
    <div className="event-mini-map"><MapPinned /><span>{family.toUpperCase()}</span>{family === "si" ? <div className="mini-circle-route" style={{ borderColor: color }} /> : <div className="mini-so-route" style={{ borderColor: color }} />}</div>
  );
}

export function MapLoadingOverlay({ progress, label }: { progress: number; label: string }) {
  return <div className="map-loading-overlay"><div className="map-loader-radar"><Radar /><i /><i /><i /></div><strong>{label}</strong><span>{progress}%</span><div className="loading-track compact"><span style={{ width: `${progress}%` }} /></div></div>;
}
