"use client";

import { getRuntimeGroups, type LiveRuntimeVehicle } from "@/lib/live-runtime";
import type { VehicleType } from "@/lib/bluewolf";
import { VehicleIconGlyph } from "./visuals";

type PositionedVehicle = {
  groupId: string;
  groupName: string;
  color: string;
  vehicle: LiveRuntimeVehicle;
  x: number;
  y: number;
};

type RawPosition = {
  groupId: string;
  groupName: string;
  color: string;
  vehicle: LiveRuntimeVehicle;
  latitude: number;
  longitude: number;
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 570;
const MARGIN_X = 70;
const MARGIN_Y = 65;
const EPS = 1e-9;

function projectedPositions(serverId: string): RawPosition[] {
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

function fitToViewport(rows: RawPosition[]): PositionedVehicle[] {
  if (rows.length === 0) return [];
  const midLatitude = rows.reduce((sum, row) => sum + row.latitude, 0) / rows.length;
  const longitudeScale = Math.max(0.15, Math.cos(midLatitude * Math.PI / 180));
  const local = rows.map((row) => ({
    ...row,
    localX: row.longitude * longitudeScale,
    localY: row.latitude,
  }));
  const minX = Math.min(...local.map((row) => row.localX));
  const maxX = Math.max(...local.map((row) => row.localX));
  const minY = Math.min(...local.map((row) => row.localY));
  const maxY = Math.max(...local.map((row) => row.localY));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const rawSpanX = Math.max(maxX - minX, EPS);
  const rawSpanY = Math.max(maxY - minY, EPS);
  // A single vehicle or a very tight formation still needs a useful viewport.
  const spanX = Math.max(rawSpanX * 1.24, rawSpanY * 0.35, 1e-5);
  const spanY = Math.max(rawSpanY * 1.24, rawSpanX * 0.35, 1e-5);
  const usableWidth = VIEW_WIDTH - 2 * MARGIN_X;
  const usableHeight = VIEW_HEIGHT - 2 * MARGIN_Y;
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);

  return local.map((row) => ({
    groupId: row.groupId,
    groupName: row.groupName,
    color: row.color,
    vehicle: row.vehicle,
    x: VIEW_WIDTH / 2 + (row.localX - centerX) * scale,
    y: VIEW_HEIGHT / 2 - (row.localY - centerY) * scale,
  }));
}

function TypeIcon({ type, color }: { type?: VehicleType; color: string }) {
  return <g transform="scale(.7)"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></g>;
}

export function OperationalLiveMap({
  serverId,
  selectedGroupId,
  selectedVehicle,
  vehicleTypes,
  showGrid,
  onSelectGroup,
  onSelectVehicle,
}: {
  serverId: string;
  selectedGroupId: string;
  selectedVehicle: number | null;
  vehicleTypes: VehicleType[];
  showGrid: boolean;
  onSelectGroup: (groupId: string) => void;
  onSelectVehicle: (vehicleId: number, groupId: string) => void;
}) {
  const points = fitToViewport(projectedPositions(serverId));
  const typeById = (id: string) => vehicleTypes.find((type) => type.id === id);
  const groupCount = new Set(points.map((point) => point.groupId)).size;

  return <svg className="map-svg v04-live-map engineering" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="מפת מיקומים מבצעית של רכבי Blue Wolf">
    <defs>
      <pattern id={`operational-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern>
    </defs>
    <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="var(--map-bg)" />
    <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} className="v04-map-wash" />
    {showGrid && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#operational-grid-${serverId})`} />}
    <g className="v04-map-labels">
      <text x="38" y="45">CORE · WGS84 LIVE</text>
      <text x="38" y="68">Auto-fit · {groupCount} קבוצות · {points.length} רכבים עם מיקום תקף</text>
    </g>
    {points.length === 0 && <g className="v04-map-labels"><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2} textAnchor="middle">אין כרגע מיקום WGS84 תקף ב־runtime snapshot</text><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2 + 28} textAnchor="middle">לא מוצג מיקום משוער מפאזה או מגאומטריית demo</text></g>}
    <g className="v04-vehicles">
      {points.map((point) => {
        const selected = point.groupId === selectedGroupId && point.vehicle.id === selectedVehicle;
        const heading = point.vehicle.headingDeg ?? 0;
        return <g key={`${point.groupId}:${point.vehicle.id}`} className={`v04-vehicle ${selected ? "selected" : ""}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`${point.groupName}, רכב ${point.vehicle.id}`} onClick={() => { onSelectGroup(point.groupId); onSelectVehicle(point.vehicle.id, point.groupId); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { onSelectGroup(point.groupId); onSelectVehicle(point.vehicle.id, point.groupId); } }}>
          {selected && <circle r="20" className="v04-selection-ring" stroke={point.color} />}
          <g transform={`rotate(${heading})`} className="v04-vehicle-body">
            <path d="M0-18 7-9 10 9 0 14-10 9-7-9Z" fill="var(--map-card)" stroke={point.color} strokeWidth="2.4" />
            <path d="M0-18 4-11H-4Z" fill={point.color} />
            <TypeIcon type={typeById(point.vehicle.typeId)} color={point.color} />
          </g>
          <g className="v04-id-label" transform="translate(0 28)"><rect x="-19" y="-9" width="38" height="18" rx="9" /><text y="4" textAnchor="middle">{point.vehicle.id}</text></g>
        </g>;
      })}
    </g>
    <g className="v04-map-scale"><text x="42" y="535">WGS84 · תצוגה יחסית auto-fit</text><text x="955" y="535" textAnchor="end">LIVE CORE</text></g>
  </svg>;
}

export const operationalMapInternals = {
  fitToViewport,
};
