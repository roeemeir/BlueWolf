"use client";

import { useMemo, useRef, useState } from "react";
import { MapPinned, Move, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SavedRoute } from "@/lib/bluewolf";
import {
  normalizeRouteGeometry,
  routeEditorPoint,
  translateRouteByEditorDrag,
  type RouteEditorPoint,
  type RouteGeoViewport,
} from "@/lib/route-bank-geometry";
import { parseRouteWkt } from "@/lib/route-wkt";
import { useWorkspace } from "./app-context";

type DragState = {
  routeId: string;
  start: RouteEditorPoint;
  geometry: string;
};

const DEFAULT_VIEWPORT: RouteGeoViewport = { west: 34.0, east: 35.0, south: 31.0, north: 33.5 };

function isWkt(value: string) {
  return /^\s*(LINESTRING|POLYGON)\b/i.test(value);
}

function routePoints(route: SavedRoute) {
  if (!isWkt(route.geometry)) return null;
  try { return parseRouteWkt(route.geometry).points; } catch { return null; }
}

function viewportFor(routes: SavedRoute[]): RouteGeoViewport {
  const points = routes.flatMap((route) => routePoints(route) ?? []);
  if (!points.length) return DEFAULT_VIEWPORT;
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  let west = Math.min(...longitudes), east = Math.max(...longitudes), south = Math.min(...latitudes), north = Math.max(...latitudes);
  const longitudeSpan = Math.max(east - west, 0.01);
  const latitudeSpan = Math.max(north - south, 0.01);
  west -= longitudeSpan * 0.15; east += longitudeSpan * 0.15;
  south -= latitudeSpan * 0.15; north += latitudeSpan * 0.15;
  return {
    west: Math.max(-180, west), east: Math.min(180, east),
    south: Math.max(-90, south), north: Math.min(90, north),
  };
}

function toSvg(longitude: number, latitude: number, viewport: RouteGeoViewport) {
  return {
    x: ((longitude - viewport.west) / (viewport.east - viewport.west)) * 900,
    y: ((viewport.north - latitude) / (viewport.north - viewport.south)) * 460,
  };
}

function pointerPct(event: React.PointerEvent<SVGSVGElement>, svg: SVGSVGElement): RouteEditorPoint {
  const rect = svg.getBoundingClientRect();
  return {
    xPct: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    yPct: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  };
}

export function RouteBankWktWorkbench() {
  const { state, save } = useWorkspace();
  const [routes, setRoutes] = useState<SavedRoute[]>(() => structuredClone(state.routes));
  const [selectedId, setSelectedId] = useState<string | null>(() => state.routes[0]?.id ?? null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const selected = routes.find((route) => route.id === selectedId) ?? null;
  const viewport = useMemo(() => viewportFor(routes), [routes]);

  const patch = (id: string, changes: Partial<SavedRoute>) => {
    setRoutes((current) => current.map((route) => route.id === id ? { ...route, ...changes, updatedAt: new Date().toISOString() } : route));
  };

  const saveBank = async () => {
    try {
      const normalized = routes.map((route) => isWkt(route.geometry) ? { ...route, geometry: normalizeRouteGeometry(route.geometry) } : route);
      const invalidLegacy = normalized.filter((route) => !isWkt(route.geometry));
      if (invalidLegacy.length) {
        toast.error(`יש ${invalidLegacy.length} נתיבים ישנים ללא WKT. יש להזין WKT אמיתי לפני שמירת בנק WKT.`);
        return;
      }
      const ok = await save({ ...state, routes: normalized }, "routes", "save-wkt-bank", `${normalized.length} WGS84 routes`);
      if (ok) setRoutes(structuredClone(normalized));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "WKT אינו תקין");
    }
  };

  const startDrag = (event: React.PointerEvent<SVGGElement>, route: SavedRoute) => {
    if (!svgRef.current || !isWkt(route.geometry)) return;
    try {
      const start = pointerPct(event as unknown as React.PointerEvent<SVGSVGElement>, svgRef.current);
      parseRouteWkt(route.geometry);
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedId(route.id);
      setDrag({ routeId: route.id, start, geometry: route.geometry });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "לא ניתן לגרור WKT לא תקין");
    }
  };

  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;
    const next = pointerPct(event, svgRef.current);
    try {
      const geometry = translateRouteByEditorDrag(drag.geometry, drag.start, next, viewport);
      const center = routeEditorPoint(geometry, viewport);
      patch(drag.routeId, { geometry, mapX: center.xPct, mapY: center.yPct });
    } catch {
      // Keep the last valid geometry while the pointer is outside a translatable WGS84 range.
    }
  };

  return <section className="glass-panel" style={{ margin: "0 0 16px", padding: 18 }} data-requirements="BW-DEV-002 BW-DEV-003 BW-OFF-005 BW-OFF-006 BW-QA-003">
    <header className="developer-section-header" style={{ marginBottom: 14 }}>
      <div><p className="eyebrow">WGS84 · מקור אמת</p><h2>בנק נתיבים — עורך WKT וגרירה</h2><p>הטקסט והמפה עורכים את אותה גאומטריה. גרירה מזיזה longitude/latitude בפועל; mapX/mapY הם תצוגה נגזרת בלבד.</p></div>
      <div className="header-actions"><Badge variant="outline">{routes.filter((route) => isWkt(route.geometry)).length}/{routes.length} WKT</Badge><Button onClick={saveBank}><Save />שמור WKT</Button></div>
    </header>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 360px)", gap: 16 }}>
      <div>
        <svg ref={svgRef} className="v04-route-bank-map" viewBox="0 0 900 460" onPointerMove={moveDrag} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)} style={{ width: "100%", minHeight: 360 }}>
          <defs><pattern id="wkt-grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="currentColor" opacity=".08" /></pattern></defs>
          <rect width="900" height="460" rx="18" /><rect width="900" height="460" fill="url(#wkt-grid)" />
          {routes.map((route) => {
            const points = routePoints(route); if (!points) return null;
            const screen = points.map((point) => toSvg(point.longitude, point.latitude, viewport));
            const d = screen.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
            const selectedRoute = route.id === selectedId;
            return <g key={route.id} onPointerDown={(event) => startDrag(event, route)} onClick={() => setSelectedId(route.id)} style={{ cursor: "grab" }}>
              <path d={d} fill="none" stroke={selectedRoute ? "currentColor" : "#8396a4"} strokeWidth={selectedRoute ? 5 : 3} opacity={selectedRoute ? 1 : .75} />
              {selectedRoute && screen[0] && <><circle cx={screen[0].x} cy={screen[0].y} r="7" /><text x={screen[0].x + 12} y={screen[0].y - 10}>{route.name}</text></>}
            </g>;
          })}
        </svg>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}><Badge variant="outline">W {viewport.west.toFixed(5)}</Badge><Badge variant="outline">E {viewport.east.toFixed(5)}</Badge><Badge variant="outline">S {viewport.south.toFixed(5)}</Badge><Badge variant="outline">N {viewport.north.toFixed(5)}</Badge></div>
      </div>
      <aside>
        {selected ? <><div style={{ display: "flex", alignItems: "center", gap: 8 }}><MapPinned /><strong>{selected.name}</strong></div><p className="card-hint">{isWkt(selected.geometry) ? "גרור את הקו במפה או ערוך את ה-WKT. שניהם נשמרים באותו שדה geometry." : "זהו נתיב legacy. לא מומצא עבורו מיקום: הדבק WKT WGS84 תקין כדי להמיר אותו."}</p><label style={{ display: "grid", gap: 6 }}><span>WKT · WGS84</span><Textarea dir="ltr" rows={10} value={selected.geometry} onChange={(event) => patch(selected.id, { geometry: event.target.value })} /></label>{isWkt(selected.geometry) && <div style={{ marginTop: 10 }}><Badge variant="outline"><Move /> ניתן לגרירה</Badge></div>}</> : <div className="empty-state"><MapPinned /><strong>בחר נתיב</strong></div>}
      </aside>
    </div>
  </section>;
}
