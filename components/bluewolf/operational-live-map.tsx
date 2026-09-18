"use client";

import { useEffect, useState } from "react";

import { normalizeEventRecompute, type EventRecomputeResult } from "@/lib/investigation-contract";
import { extractLiveMapEventEvidence, type LiveMapEventEvidence } from "@/lib/live-map-evidence";
import { getRuntimeGroups, getRuntimeTrace, type LiveRuntimeVehicle } from "@/lib/live-runtime";
import { getLiveRuntimeHistory } from "@/lib/live-runtime-history";
import { normalizeMapSources, type OperationalMapSource } from "@/lib/map-source-config";
import { createOperationalProjection, type GeoPoint } from "@/lib/operational-map-projection";
import {
  currentOperatorCursor,
  resolveOperatorCursorFrame,
  subscribeOperatorCursor,
  traceUpToCursor,
} from "@/lib/operator-time-cursor";
import { traceWithEventRecompute } from "@/lib/operator-retroactive-result";
import { DEFAULT_TRACE_WINDOW_MINUTES, filterTraceWindow, traceScoreColor, traceSegments } from "@/lib/score-trace";
import { defaultWmtsLayerSelections, wmtsProjectionKind } from "@/lib/wmts-capabilities";
import type { VehicleType } from "@/lib/bluewolf";
import { vehicleTypeMatchesId } from "@/lib/vehicle-id-ranges";
import { useWorkspace } from "./app-context";
import { OperationalBasemap } from "./operational-basemap";
import { VehicleIconGlyph } from "./visuals";

type MapVehicle = Pick<LiveRuntimeVehicle, "id" | "typeId" | "headingDeg">;
type RawPosition = { groupId: string; groupName: string; color: string; vehicle: MapVehicle; latitude: number; longitude: number };

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 570;
const MARGIN_X = 70;
const MARGIN_Y = 65;
const TRACE_WINDOWS = [30, 60, 90] as const;

function livePositions(serverId: string): RawPosition[] {
  return getRuntimeGroups(serverId).flatMap((group) => group.members.flatMap((vehicle) => {
    if (vehicle.latitude === undefined || vehicle.longitude === undefined) return [];
    return [{ groupId: group.id, groupName: group.name, color: group.color, vehicle, latitude: vehicle.latitude, longitude: vehicle.longitude }];
  }));
}

function viewportProjector(rows: readonly GeoPoint[]) {
  return createOperationalProjection(rows, VIEW_WIDTH, VIEW_HEIGHT, MARGIN_X, MARGIN_Y, "local-wgs84").project;
}

function activeMapSource(rawSources: unknown, defaultMap: string): OperationalMapSource | null {
  try {
    const sources = normalizeMapSources(rawSources);
    return sources.find((source) => source.id === defaultMap && source.enabled)
      ?? sources.find((source) => source.isDefault && source.enabled)
      ?? sources.find((source) => source.enabled)
      ?? null;
  } catch {
    return null;
  }
}

function TypeIcon({ type, color }: { type?: VehicleType; color: string }) { return <g transform="scale(.7)"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></g>; }
function convexHull(points: { x: number; y: number }[]) {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop(); lower.push(point); }
  const upper: { x: number; y: number }[] = [];
  for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop(); return [...lower, ...upper];
}

export function OperationalLiveMap({
  serverId, selectedGroupId, selectedVehicle, vehicleTypes, showGrid, showTrace, onSelectGroup, onSelectVehicle, recomputeOverride, mapProfile,
}: {
  serverId: string;
  selectedGroupId: string;
  selectedVehicle: number | null;
  vehicleTypes: VehicleType[];
  showGrid: boolean;
  showTrace: boolean;
  onSelectGroup: (groupId: string) => void;
  onSelectVehicle: (vehicleId: number, groupId: string) => void;
  recomputeOverride?: EventRecomputeResult | null;
  mapProfile?: string;
}) {
  const { state } = useWorkspace();
  const mapSource = activeMapSource(state.mapServers, mapProfile ?? state.settings.defaultMap);
  const runtimeGroups = getRuntimeGroups(serverId);
  const selectedRuntimeGroup = runtimeGroups.find((group) => group.id === selectedGroupId);
  const activeEventId = selectedRuntimeGroup?.event?.id;
  const activeTemplateId = selectedRuntimeGroup?.templateId;
  const [eventEvidence, setEventEvidence] = useState<LiveMapEventEvidence | null>(null);
  const [showBase, setShowBase] = useState(true);
  const [showObservedTrace, setShowObservedTrace] = useState(false);
  const [showScoreTrace, setShowScoreTrace] = useState(showTrace);
  const [showDetectedRoute, setShowDetectedRoute] = useState(true);
  const [showGroups, setShowGroups] = useState(true);
  const [showTemplate, setShowTemplate] = useState(true);
  const [showContext, setShowContext] = useState(showGrid);
  useEffect(() => setShowScoreTrace(showTrace), [showTrace]);
  const [traceWindowMinutes, setTraceWindowMinutes] = useState<number>(DEFAULT_TRACE_WINDOW_MINUTES);
  const [wmtsVisibility, setWmtsVisibility] = useState<Record<string, string[]>>({});
  const [cursorObservedAt, setCursorObservedAt] = useState<string | null>(() => currentOperatorCursor(serverId));

  useEffect(() => {
    setCursorObservedAt(currentOperatorCursor(serverId));
    return subscribeOperatorCursor(serverId, setCursorObservedAt);
  }, [serverId]);

  useEffect(() => {
    if (cursorObservedAt || recomputeOverride || !activeEventId || !activeTemplateId) return;
    let cancelled = false;
    void fetch("/api/investigation/recompute", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, cache: "no-store",
      body: JSON.stringify({ eventId: activeEventId, templateId: activeTemplateId, scenarioId: `operator-map:${activeEventId}:${activeTemplateId}` }),
    }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(`map evidence recompute failed (${response.status})`);
      return normalizeEventRecompute(payload);
    }).then((result) => {
      if (!cancelled && result.eventId === activeEventId && result.templateId === activeTemplateId) setEventEvidence(extractLiveMapEventEvidence(result));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeEventId, activeTemplateId, recomputeOverride, cursorObservedAt]);

  const overrideEvidence = recomputeOverride ? extractLiveMapEventEvidence(recomputeOverride) : null;
  const evidence = cursorObservedAt ? null : overrideEvidence ?? (eventEvidence && eventEvidence.eventId === activeEventId && eventEvidence.templateId === activeTemplateId ? eventEvidence : null);
  const fullTrace = recomputeOverride && !cursorObservedAt
    ? traceWithEventRecompute(getRuntimeTrace(serverId, TRACE_WINDOWS.at(-1) ?? 90), recomputeOverride)
    : getRuntimeTrace(serverId, TRACE_WINDOWS.at(-1) ?? 90);
  const cursorFrame = cursorObservedAt ? resolveOperatorCursorFrame(getLiveRuntimeHistory(serverId), fullTrace, cursorObservedAt) : null;
  const cursorTimeMs = cursorFrame?.timeMs ?? null;
  const clippedTrace = traceUpToCursor(fullTrace, cursorTimeMs);
  const history = filterTraceWindow(clippedTrace, traceWindowMinutes);
  const current = cursorObservedAt
    ? (cursorFrame?.vehicles ?? []).map((row): RawPosition => {
        const group = cursorFrame?.groups.find((item) => item.id === row.groupId);
        const stableType = vehicleTypes.find((type) => vehicleTypeMatchesId(row.vehicleId, type));
        return {
          groupId: row.groupId,
          groupName: group?.name ?? row.groupId,
          color: group?.color ?? "#7b8790",
          vehicle: { id: row.vehicleId, typeId: stableType?.id ?? "unknown" },
          latitude: row.latitude,
          longitude: row.longitude,
        };
      })
    : livePositions(serverId);
  const routeEvidence = cursorObservedAt ? [] : evidence?.routes ?? selectedRuntimeGroup?.detectedRoutes ?? [];
  const templateAssignments = cursorObservedAt ? [] : evidence?.assignments ?? [];
  const routePoints = routeEvidence.flatMap((route) => route.centerline);
  const geoRows: GeoPoint[] = [...history.map((point) => ({ latitude: point.latitude, longitude: point.longitude })), ...current, ...routePoints];

  const wmtsSelections = mapSource?.kind === "wmts" && mapSource.wmtsCatalog
    ? mapSource.wmtsLayers ?? defaultWmtsLayerSelections(mapSource.wmtsCatalog)
    : [];
  const defaultVisibleWmts = wmtsSelections.filter((selection) => selection.enabled).map((selection) => selection.layer);
  const visibleWmtsLayers = mapSource?.kind === "wmts" ? (wmtsVisibility[mapSource.id] ?? defaultVisibleWmts) : undefined;
  const visibleMatrixSets = mapSource?.kind === "wmts" && mapSource.wmtsCatalog
    ? wmtsSelections.filter((selection) => visibleWmtsLayers?.includes(selection.layer)).flatMap((selection) => mapSource.wmtsCatalog?.tileMatrixSets.filter((matrixSet) => matrixSet.identifier === selection.tileMatrixSet) ?? [])
    : [];
  const projectionMode = mapSource?.kind === "xyz"
    || (mapSource?.kind === "wmts" && !mapSource.wmtsCatalog)
    || visibleMatrixSets.some((matrixSet) => wmtsProjectionKind(matrixSet.supportedCrs) === "webmercator")
    ? "webmercator"
    : "local-wgs84";
  const projection = createOperationalProjection(geoRows, VIEW_WIDTH, VIEW_HEIGHT, MARGIN_X, MARGIN_Y, projectionMode);
  const project = projection.project;
  const projectedHistory = history.map((point) => ({ ...point, ...project(point.latitude, point.longitude) }));
  const segments = traceSegments(projectedHistory);
  const points = current.map((row) => ({ ...row, ...project(row.latitude, row.longitude) }));
  const typeById = (id: string) => vehicleTypes.find((type) => type.id === id);
  const groupCount = new Set(points.map((point) => point.groupId)).size;
  const assignmentByVehicle = new Map(templateAssignments.map((assignment) => [assignment.vehicleIdentifier, assignment]));
  const toggleWmtsLayer = (layer: string) => {
    if (!mapSource || mapSource.kind !== "wmts") return;
    setWmtsVisibility((currentVisibility) => {
      const currentLayers = currentVisibility[mapSource.id] ?? defaultVisibleWmts;
      const next = currentLayers.includes(layer) ? currentLayers.filter((item) => item !== layer) : [...currentLayers, layer];
      return { ...currentVisibility, [mapSource.id]: next };
    });
  };
  const historical = cursorObservedAt !== null;
  const historicalLabel = cursorFrame ? new Date(cursorFrame.timeMs).toLocaleTimeString("he-IL") : null;

  return <div className="operational-map-layer-shell" dir="rtl" data-requirements="OP-02 OP-04 BW-OFF-010 BW-UI-005">
    <div className="v04-map-layer-controls" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px" }}>
      <button type="button" className={showBase ? "active" : ""} onClick={() => setShowBase((value) => !value)}>בסיס</button>
      <button type="button" className={showObservedTrace ? "active" : ""} onClick={() => setShowObservedTrace((value) => !value)}>עקבה נצפית</button>
      <button type="button" className={showScoreTrace ? "active" : ""} onClick={() => setShowScoreTrace((value) => !value)}>עקבה לפי ציון</button>
      <button type="button" disabled={historical} className={showDetectedRoute && !historical ? "active" : ""} onClick={() => setShowDetectedRoute((value) => !value)}>נתיב מזוהה</button>
      <button type="button" className={showGroups ? "active" : ""} onClick={() => setShowGroups((value) => !value)}>קבוצות</button>
      <button type="button" disabled={historical} className={showTemplate && !historical ? "active" : ""} onClick={() => setShowTemplate((value) => !value)}>תבנית</button>
      <button type="button" className={showContext ? "active" : ""} onClick={() => setShowContext((value) => !value)}>יחסים / רשת</button>
      <span aria-label="חלון עקבה">חלון:</span>
      {TRACE_WINDOWS.map((minutes) => <button type="button" key={minutes} className={traceWindowMinutes === minutes ? "active" : ""} onClick={() => setTraceWindowMinutes(minutes)}>{minutes} דק׳</button>)}
      {wmtsSelections.length > 0 && <><span aria-label="שכבות WMTS">WMTS:</span>{wmtsSelections.map((selection) => {
        const layer = mapSource?.wmtsCatalog?.layers.find((item) => item.identifier === selection.layer);
        const visible = visibleWmtsLayers?.includes(selection.layer) ?? false;
        return <button type="button" key={selection.layer} className={visible ? "active" : ""} data-wmts-layer-toggle={selection.layer} onClick={() => toggleWmtsLayer(selection.layer)}>{layer?.title ?? selection.layer}</button>;
      })}</>}
      {mapSource && <span className="card-hint" data-map-source-active>{mapSource.name} · {mapSource.kind.toUpperCase()} · proxy מקומי</span>}
      {historical && <span className="card-hint" data-operator-map-cursor>{cursorFrame ? `HISTORY · ${historicalLabel} · WGS84 evidence` : "HISTORY · אין WGS84 evidence תואם; לא מוצג live fallback"}</span>}
      {!historical && !evidence && activeEventId && <span className="card-hint">שיוכי template מפורטים טרם זמינים; נתיב חי מוצג רק אם הגיע ישירות מה־Core.</span>}
      {!historical && recomputeOverride && <span className="card-hint" data-op04-version>run {recomputeOverride.runId.slice(0, 12)} · template {recomputeOverride.templateVersion.slice(0, 12)}</span>}
    </div>
    <svg className="map-svg v04-live-map engineering" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="מפת מיקומים מבצעית של רכבי Blue Wolf">
      <defs><pattern id={`operational-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern></defs>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="var(--map-bg)" />
      {showBase && <OperationalBasemap source={mapSource} projection={projection} visibleWmtsLayers={visibleWmtsLayers} />}
      {showBase && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} className="v04-map-wash" />}
      {showContext && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#operational-grid-${serverId})`} />}
      <g className="v04-map-labels"><text x="38" y="45">CORE · WGS84 {historical ? "HISTORY" : "LIVE"}</text><text x="38" y="68">Auto-fit · {groupCount} קבוצות · {points.length} רכבים עם מיקום תקף · עקבה {traceWindowMinutes} דק׳</text></g>
      {points.length === 0 && routeEvidence.length === 0 && <g className="v04-map-labels"><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2} textAnchor="middle">{historical ? "אין מיקום WGS84 תואם בנקודת הזמן שנבחרה" : "אין כרגע מיקום WGS84 או route evidence תקף"}</text><text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2 + 28} textAnchor="middle">לא מוצג מיקום משוער מפאזה, demo או snapshot חי אחר</text></g>}
      {showDetectedRoute && !historical && <g className="v04-detected-routes">{routeEvidence.map((route) => {
        const coordinates = route.centerline.map((point) => project(point.latitude, point.longitude)); if (coordinates.length < 2) return null;
        const closed = [...coordinates, coordinates[0]];
        return <polyline key={route.routeInstanceId} points={closed.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={selectedRuntimeGroup?.color ?? "#4378e8"} strokeWidth="3"><title>{route.routeId} · {route.subtype} · quality {route.detectionQuality.toFixed(2)}</title></polyline>;
      })}</g>}
      {showObservedTrace && <g className="observed-trace">{segments.map(([a, b]) => <line key={`observed:${b.vehicleId}:${b.timeMs}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7b8790" strokeWidth="2" opacity=".58"><title>עקבה נצפית · רכב {b.vehicleId} · {new Date(b.timeMs).toLocaleTimeString("he-IL")}</title></line>)}</g>}
      {showScoreTrace && <g className="score-trace">{segments.map(([a, b]) => <line key={`score:${b.vehicleId}:${b.timeMs}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: traceScoreColor(b.sync) }}><title>רכב {b.vehicleId} · סנכרון {b.sync === null ? "אין מידע" : Math.round(b.sync)} · {new Date(b.timeMs).toLocaleTimeString("he-IL")}</title></line>)}</g>}
      {showGroups && <g className="v04-group-shapes">{runtimeGroups.map((group) => {
        const groupPoints = points.filter((point) => point.groupId === group.id);
        if (groupPoints.length < 2) return null;
        const hull = convexHull(groupPoints);
        return <polygon key={`shape:${group.id}`} points={hull.map((point) => `${point.x},${point.y}`).join(" ")} fill={group.color} fillOpacity=".09" stroke={group.color} strokeOpacity=".72" strokeWidth="2"><title>{group.name}</title></polygon>;
      })}</g>}
      {showGroups && <g className="v04-vehicles">{points.map((point) => {
        const selected = !historical && point.groupId === selectedGroupId && point.vehicle.id === selectedVehicle; const heading = point.vehicle.headingDeg ?? 0;
        const activate = () => { if (historical) return; onSelectGroup(point.groupId); onSelectVehicle(point.vehicle.id, point.groupId); };
        return <g key={`${point.groupId}:${point.vehicle.id}`} className={`v04-vehicle ${selected ? "selected" : ""}`} transform={`translate(${point.x} ${point.y})`} role={historical ? undefined : "button"} tabIndex={historical ? undefined : 0} aria-disabled={historical || undefined} aria-label={`${point.groupName}, רכב ${point.vehicle.id}${historical ? ", היסטורי" : ""}`} onClick={activate} onKeyDown={(event) => { if (!historical && (event.key === "Enter" || event.key === " ")) activate(); }}>
          {selected && <circle r="20" className="v04-selection-ring" stroke={point.color} />}<g transform={`rotate(${heading})`} className="v04-vehicle-body"><path d="M0-18 7-9 10 9 0 14-10 9-7-9Z" fill="var(--map-card)" stroke={point.color} strokeWidth="2.4" /><path d="M0-18 4-11H-4Z" fill={point.color} /><TypeIcon type={typeById(point.vehicle.typeId)} color={point.color} /></g><g className="v04-id-label" transform="translate(0 28)"><rect x="-19" y="-9" width="38" height="18" rx="9" /><text y="4" textAnchor="middle">{point.vehicle.id}</text></g>
        </g>;
      })}</g>}
      {showTemplate && !historical && <g className="v04-template-assignment-layer">{points.map((point) => {
        const assignment = assignmentByVehicle.get(point.vehicle.id); if (!assignment) return null;
        return <g key={`template:${point.vehicle.id}`} transform={`translate(${point.x + 18} ${point.y - 22})`}><rect x="0" y="-18" width="116" height="24" rx="10" fill="var(--map-card)" opacity=".9" /><text x="8" y="0" textAnchor="start" stroke="none">{assignment.slotId} · φ {Math.round(assignment.expectedPhase * 100)}%</text></g>;
      })}{(recomputeOverride?.templateId ?? activeTemplateId) && <text x={VIEW_WIDTH - 42} y="45" textAnchor="end" stroke="none">Template: {recomputeOverride?.templateId ?? activeTemplateId}</text>}</g>}
      <g className="v04-map-scale"><text x="42" y="535">{mapSource ? `${mapSource.kind.toUpperCase()} · ` : ""}WGS84 · תצוגה יחסית auto-fit</text><text x="955" y="535" textAnchor="end">{historical ? "HISTORICAL EVIDENCE" : "LIVE CORE"}</text></g>
    </svg>
  </div>;
}

export const operationalMapInternals = { viewportProjector, createOperationalProjection };