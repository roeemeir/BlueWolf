"use client";

import type { VehicleType } from "@/lib/bluewolf";
import { getLivePositionHistory, type LivePositionHistoryPoint } from "@/lib/live-position-history";
import { getRuntimeGroups, type LiveRuntimeVehicle } from "@/lib/live-runtime";
import { VehicleIconGlyph } from "./visuals";

type RawPosition = {
  groupId: string;
  groupName: string;
  color: string;
  vehicle: LiveRuntimeVehicle;
  latitude: number;
  longitude: number;
};

type MapPoint = { x: number; y: number };
type Projection = { project: (latitude: number, longitude: number) => MapPoint };

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 570;
const MARGIN_X = 70;
const MARGIN_Y = 65;
const EPS = 1e-9;

function currentPositions(serverId: string): RawPosition[] {
  return getRuntimeGroups(serverId).flatMap((group) => group.members.flatMap((vehicle) => {
    if (vehicle.latitude === undefined || vehicle.longitude === undefined) return [];
    return [{
      groupId: group.id,
      groupName: group.name,
      color: group.color,
      vehicle,
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
    }];
  }));
}

function buildProjection(rows: Array<{ latitude: number; longitude: number }>): Projection | null {
  if (rows.length === 0) return null;
  const midLatitude = rows.reduce((sum, row) => sum + row.latitude, 0) / rows.length;
  const longitudeScale = Math.max(0.15, Math.cos(midLatitude * Math.PI / 180));
  const local = rows.map((row) => ({ x: row.longitude * longitudeScale, y: row.latitude }));
  const minX = Math.min(...local.map((row) => row.x));
  const maxX = Math.max(...local.map((row) => row.x));
  const minY = Math.min(...local.map((row) => row.y));
  const maxY = Math.max(...local.map((row) => row.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const rawSpanX = Math.max(maxX - minX, EPS);
  const rawSpanY = Math.max(maxY - minY, EPS);
  const spanX = Math.max(rawSpanX * 1.24, rawSpanY * 0.35, 1e-5);
  const spanY = Math.max(rawSpanY * 1.24, rawSpanX * 0.35, 1e-5);
  const scale = Math.min((VIEW_WIDTH - 2 * MARGIN_X) / spanX, (VIEW_HEIGHT - 2 * MARGIN_Y) / spanY);
  return {
    project(latitude, longitude) {
      const x = longitude * longitudeScale;
      return {
        x: VIEW_WIDTH / 2 + (x - centerX) * scale,
        y: VIEW_HEIGHT / 2 - (latitude - centerY) * scale,
      };
    },
  };
}

function syncColor(score: number | null) {
  if (score === null) return "var(--text-faint)";
  const bounded = Math.max(0, Math.min(100, score));
  return `hsl(${bounded * 1.2} 72% 46%)`;
}

function TypeIcon({ type, color }: { type?: VehicleType; color: string }) {
  return <g transform="scale(.7)"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></g>;
}

function TraceLayer({ rows, projection, scoreColored }: { rows: LivePositionHistoryPoint[]; projection: Projection; scoreColored: boolean }) {
  return <g className={`v04-operational-trace ${scoreColored ? "score" : "plain"}`} aria-label={scoreColored ? "עקבה בצבע לפי Sync Score" : "עקבת תנועה"}>
    {rows.map((point) => {
      const mapped = projection.project(point.latitude, point.longitude);
      return <circle
        key={`${point.bucketMs}:${point.groupId}:${point.vehicleId}`}
        cx={mapped.x}
        cy={mapped.y}
        r={scoreColored ? 3.2 : 2.5}
        fill={scoreColored ? syncColor(point.sync) : point.groupColor}
        opacity={scoreColored ? .82 : .34}
      />;
    })}
  </g>;
}

export function OperationalLiveMap({
  serverId,
  selectedGroupId,
  selectedVehicle,
  vehicleTypes,
  showGrid,
  showTrace = true,
  showScoreTrace = false,
  trailMinutes = 30,
  onSelectGroup,
  onSelectVehicle,
}: {
  serverId: string;
  selectedGroupId: string;
  selectedVehicle: number | null;
  vehicleTypes: VehicleType[];
  showGrid: boolean;
  showTrace?: boolean;
  showScoreTrace?: boolean;
  trailMinutes?: number;
  onSelectGroup: (groupId: string) => void;
  onSelectVehicle: (vehicleId: number, groupId: string) => void;
}) {
  const current = currentPositions(serverId);
  const history = getLivePositionHistory(serverId, trailMinutes);
  const projectionRows = (showTrace || showScoreTrace) && history.length > 0 ? [...current, ...history] : current;
  const projection = buildProjection(projectionRows);
  const typeById = (id: string) => vehicleTypes.find((type) => type.id === id);
  const groupCount = new Set(current.map((point) => point.groupId)).size;

  return <svg className="map-svg v04-live-map engineering" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="מפת מיקומים מבצעית של רכבי Blue Wolf">
    <defs>
      <pattern id={`operational-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern>
      <linearGradient id={`sync-trace-gradient-${serverId}`} x1="0" x2="1"><stop offset="0%" stopColor="hsl(0 72% 46%)" /><stop offset="50%" stopColor="hsl(60 72% 46%)" /><stop offset="100%" stopColor="hsl(120 72% 46%)" /></linearGradient>
    </defs>
    <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="var(--map-bg)" />
    <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} className="v04-map-wash" />
    {showGrid && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#operational-grid-${serverId})`} />}
    <g className="v04-map-labels">
      <text x="38" y="45">CORE · WGS84 LIVE</text>
      <text x="38" y="68">Auto-fit · {groupCount} קבוצות · {current.length} רכבים · עקבה {trailMinutes} דק׳</text>
    </g>

    {projection && showTrace && !showScoreTrace && <TraceLayer rows={history} projection={projection} scoreColored={false} />}
    {projection && showScoreTrace && <TraceLayer rows={history} projection={projection} scoreColored />}

    {current.length === 0 && <g className="v04-map-labels"><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2} textAnchor="middle">אין כרגע מיקום WGS84 תקף ב־runtime snapshot</text><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2 + 28} textAnchor="middle">לא מוצג מיקום משוער מפאזה או מגאומטריית demo</text></g>}

    {projection && <g className="v04-vehicles">
      {current.map((point) => {
        const mapped = projection.project(point.latitude, point.longitude);
        const selected = point.groupId === selectedGroupId && point.vehicle.id === selectedVehicle;
        const heading = point.vehicle.headingDeg ?? 0;
        return <g key={`${point.groupId}:${point.vehicle.id}`} className={`v04-vehicle ${selected ? "selected" : ""}`} transform={`translate(${mapped.x} ${mapped.y})`} role="button" tabIndex={0} aria-label={`${point.groupName}, רכב ${point.vehicle.id}`} onClick={() => { onSelectGroup(point.groupId); onSelectVehicle(point.vehicle.id, point.groupId); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { onSelectGroup(point.groupId); onSelectVehicle(point.vehicle.id, point.groupId); } }}>
          {selected && <circle r="20" className="v04-selection-ring" stroke={point.color} />}
          <g transform={`rotate(${heading})`} className="v04-vehicle-body">
            <path d="M0-18 7-9 10 9 0 14-10 9-7-9Z" fill="var(--map-card)" stroke={point.color} strokeWidth="2.4" />
            <path d="M0-18 4-11H-4Z" fill={point.color} />
            <TypeIcon type={typeById(point.vehicle.typeId)} color={point.color} />
          </g>
          <g className="v04-id-label" transform="translate(0 28)"><rect x="-19" y="-9" width="38" height="18" rx="9" /><text y="4" textAnchor="middle">{point.vehicle.id}</text></g>
        </g>;
      })}
    </g>}

    {showScoreTrace && <g className="v04-score-trace-legend" transform="translate(730 500)">
      <rect x="0" y="0" width="226" height="46" rx="12" />
      <text x="12" y="16">Sync Score Trace</text>
      <rect x="12" y="24" width="160" height="8" rx="4" fill={`url(#sync-trace-gradient-${serverId})`} />
      <text x="12" y="42">0</text><text x="92" y="42" textAnchor="middle">50</text><text x="172" y="42" textAnchor="end">100</text>
    </g>}
    <g className="v04-map-scale"><text x="42" y="535">WGS84 · marker/hull = Group · Score Trace = Sync</text><text x="955" y="535" textAnchor="end">LIVE CORE</text></g>
  </svg>;
}

export const operationalMapInternals = {
  buildProjection,
  syncColor,
};
