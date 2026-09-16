"use client";

import { useEffect, useState } from "react";

import { normalizeEventRecompute } from "@/lib/investigation-contract";
import { extractLiveMapEventEvidence, type LiveMapEventEvidence } from "@/lib/live-map-evidence";
import { getRuntimeGroups, getRuntimeTrace, type LiveRuntimeVehicle } from "@/lib/live-runtime";
import { DEFAULT_TRACE_WINDOW_MINUTES, filterTraceWindow, traceScoreColor, traceSegments } from "@/lib/score-trace";
import type { VehicleType } from "@/lib/bluewolf";
import { VehicleIconGlyph } from "./visuals";

type RawPosition = {
  groupId: string;
  groupName: string;
  color: string;
  vehicle: LiveRuntimeVehicle;
  latitude: number;
  longitude: number;
};

type GeoPoint = { latitude: number; longitude: number };
type ScreenPoint = { x: number; y: number };

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 570;
const MARGIN_X = 70;
const MARGIN_Y = 65;
const EPS = 1e-9;
const TRACE_WINDOWS = [30, 60, 90] as const;

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

function viewportProjector(rows: readonly GeoPoint[]) {
  if (rows.length === 0) return (_latitude: number, _longitude: number): ScreenPoint => ({ x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 });
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
  const usableWidth = VIEW_WIDTH - 2 * MARGIN_X;
  const usableHeight = VIEW_HEIGHT - 2 * MARGIN_Y;
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  return (latitude: number, longitude: number) => ({
    x: VIEW_WIDTH / 2 + (longitude * longitudeScale - centerX) * scale,
    y: VIEW_HEIGHT / 2 - (latitude - centerY) * scale,
  });
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
  showTrace,
  onSelectGroup,
  onSelectVehicle,
}: {
  serverId: string;
  selectedGroupId: string;
  selectedVehicle: number | null;
  vehicleTypes: VehicleType[];
  showGrid: boolean;
  showTrace: boolean;
  onSelectGroup: (groupId: string) => void;
  onSelectVehicle: (vehicleId: number, groupId: string) => void;
}) {
  const runtimeGroups = getRuntimeGroups(serverId);
  const selectedRuntimeGroup = runtimeGroups.find((group) => group.id === selectedGroupId);
  const activeEventId = selectedRuntimeGroup?.event?.id;
  const activeTemplateId = selectedRuntimeGroup?.templateId;
  const [eventEvidence, setEventEvidence] = useState<LiveMapEventEvidence | null>(null);
  const [showObservedTrace, setShowObservedTrace] = useState(false);
  const [showDetectedRoute, setShowDetectedRoute] = useState(true);
  const [showGroups, setShowGroups] = useState(true);
  const [showTemplate, setShowTemplate] = useState(true);
  const [traceWindowMinutes, setTraceWindowMinutes] = useState<number>(DEFAULT_TRACE_WINDOW_MINUTES);

  useEffect(() => {
    if (!activeEventId || !activeTemplateId) return;
    let cancelled = false;
    void fetch("/api/investigation/recompute", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        eventId: activeEventId,
        templateId: activeTemplateId,
        scenarioId: `operator-map:${activeEventId}:${activeTemplateId}`,
      }),
    }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(`map evidence recompute failed (${response.status})`);
      return normalizeEventRecompute(payload);
    }).then((result) => {
      if (!cancelled && result.eventId === activeEventId && result.templateId === activeTemplateId) {
        setEventEvidence(extractLiveMapEventEvidence(result));
      }
    }).catch(() => {
      // Fail closed: stale evidence is ignored below by event/template provenance.
    });
    return () => { cancelled = true; };
  }, [activeEventId, activeTemplateId]);

  const evidence = eventEvidence && eventEvidence.eventId === activeEventId && eventEvidence.templateId === activeTemplateId ? eventEvidence : null;
  const current = projectedPositions(serverId);
  const history = filterTraceWindow(getRuntimeTrace(serverId, TRACE_WINDOWS.at(-1) ?? 90), traceWindowMinutes);
  const routeEvidence = evidence?.routes ?? selectedRuntimeGroup?.detectedRoutes ?? [];
  const templateAssignments = evidence?.assignments ?? [];
  const routePoints = routeEvidence.flatMap((route) => route.centerline);
  const project = viewportProjector([
    ...history.map((point) => ({ latitude: point.latitude, longitude: point.longitude })),
    ...current,
    ...routePoints,
  ]);
  const projectedHistory = history.map((point) => ({ ...point, ...project(point.latitude, point.longitude) }));
  const segments = traceSegments(projectedHistory);
  const points = current.map((row) => ({ ...row, ...project(row.latitude, row.longitude) }));
  const typeById = (id: string) => vehicleTypes.find((type) => type.id === id);
  const groupCount = new Set(points.map((point) => point.groupId)).size;
  const assignmentByVehicle = new Map(templateAssignments.map((assignment) => [assignment.vehicleIdentifier, assignment]));

  return <div className="operational-map-layer-shell" dir="rtl" data-requirements="OP-02">
    <div className="v04-map-layer-controls" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px" }}>
      <button type="button" className={showObservedTrace ? "active" : ""} onClick={() => setShowObservedTrace((value) => !value)}>עקבה נצפית</button>
      <button type="button" className={showDetectedRoute ? "active" : ""} onClick={() => setShowDetectedRoute((value) => !value)}>נתיב מזוהה</button>
      <button type="button" className={showGroups ? "active" : ""} onClick={() => setShowGroups((value) => !value)}>קבוצות</button>
      <button type="button" className={showTemplate ? "active" : ""} onClick={() => setShowTemplate((value) => !value)}>תבנית</button>
      <span aria-label="חלון עקבה">חלון:</span>
      {TRACE_WINDOWS.map((minutes) => <button type="button" key={minutes} className={traceWindowMinutes === minutes ? "active" : ""} onClick={() => setTraceWindowMinutes(minutes)}>{minutes} דק׳</button>)}
      {!evidence && activeEventId && <span className="card-hint">שיוכי template מפורטים טרם זמינים; נתיב חי מוצג רק אם הגיע ישירות מה־Core.</span>}
    </div>
    <svg className="map-svg v04-live-map engineering" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="מפת מיקומים מבצעית של רכבי Blue Wolf">
      <defs>
        <pattern id={`operational-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern>
      </defs>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="var(--map-bg)" />
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} className="v04-map-wash" />
      {showGrid && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#operational-grid-${serverId})`} />}
      <g className="v04-map-labels">
        <text x="38" y="45">CORE · WGS84 LIVE</text>
        <text x="38" y="68">Auto-fit · {groupCount} קבוצות · {points.length} רכבים עם מיקום תקף · עקבה {traceWindowMinutes} דק׳</text>
      </g>
      {points.length === 0 && routeEvidence.length === 0 && <g className="v04-map-labels"><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2} textAnchor="middle">אין כרגע מיקום WGS84 או route evidence תקף</text><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2 + 28} textAnchor="middle">לא מוצג מיקום משוער מפאזה או מגאומטריית demo</text></g>}
      {showDetectedRoute && <g className="v04-detected-routes">{routeEvidence.map((route) => {
        const coordinates = route.centerline.map((point) => project(point.latitude, point.longitude));
        if (coordinates.length < 2) return null;
        const closed = [...coordinates, coordinates[0]];
        return <polyline key={route.routeInstanceId} points={closed.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--muted-foreground)" strokeWidth="2.5" strokeDasharray="10 5"><title>{route.routeId} · {route.subtype} · quality {route.detectionQuality.toFixed(2)}</title></polyline>;
      })}</g>}
      {showObservedTrace && <g className="observed-trace">{segments.map(([a, b]) => <line key={`observed:${b.vehicleId}:${b.timeMs}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7b8790" strokeWidth="2" opacity=".58"><title>עקבה נצפית · רכב {b.vehicleId} · {new Date(b.timeMs).toLocaleTimeString("he-IL")}</title></line>)}</g>}
      {showTrace && <g className="score-trace">{segments.map(([a, b]) => <line key={`score:${b.vehicleId}:${b.timeMs}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: traceScoreColor(b.sync) }}><title>רכב {b.vehicleId} · סנכרון {b.sync === null ? "אין מידע" : Math.round(b.sync)} · {new Date(b.timeMs).toLocaleTimeString("he-IL")}</title></line>)}</g>}
      {showGroups && <g className="v04-vehicles">
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
      </g>}
      {showTemplate && <g className="v04-template-assignment-layer">{points.map((point) => {
        const assignment = assignmentByVehicle.get(point.vehicle.id);
        if (!assignment) return null;
        return <g key={`template:${point.vehicle.id}`} transform={`translate(${point.x + 18} ${point.y - 22})`}><rect x="0" y="-18" width="116" height="24" rx="10" fill="var(--map-card)" opacity=".9" /><text x="8" y="0" textAnchor="start" stroke="none">{assignment.slotId} · φ {Math.round(assignment.expectedPhase * 100)}%</text></g>;
      })}{activeTemplateId && <text x={VIEW_WIDTH - 42} y="45" textAnchor="end" stroke="none">Template: {activeTemplateId}</text>}</g>}
      <g className="v04-map-scale"><text x="42" y="535">WGS84 · תצוגה יחסית auto-fit</text><text x="955" y="535" textAnchor="end">LIVE CORE</text></g>
    </svg>
  </div>;
}

export const operationalMapInternals = {
  viewportProjector,
};