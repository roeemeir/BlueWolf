"use client";

import { useMemo, useRef, useState } from "react";
import { MapPinned, Move, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createId, type Family, type SavedRoute, type SoRouteKind } from "@/lib/bluewolf";
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

function seedGeometry(family: Family, routeKind: SoRouteKind | "compact", viewport: RouteGeoViewport) {
  const lon = (viewport.west + viewport.east) / 2;
  const lat = (viewport.south + viewport.north) / 2;
  const dx = Math.max((viewport.east - viewport.west) * 0.07, 0.0012);
  const dy = Math.max((viewport.north - viewport.south) * 0.05, 0.0008);
  const local = family === "SI"
    ? Array.from({ length: 17 }, (_, index) => {
        const angle = index / 16 * Math.PI * 2;
        return [lon + Math.cos(angle) * dx, lat + Math.sin(angle) * dy] as const;
      })
    : routeKind === "double"
      ? [[lon - dx * 1.7, lat], [lon - dx * .7, lat - dy], [lon, lat - dy * .25], [lon + dx * .7, lat - dy], [lon + dx * 1.7, lat], [lon + dx * .7, lat + dy], [lon, lat + dy * .25], [lon - dx * .7, lat + dy], [lon - dx * 1.7, lat]] as const
      : [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx * 1.25, lat], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx * 1.25, lat], [lon - dx, lat - dy]] as const;
  return `LINESTRING(${local.map(([longitude, latitude]) => `${longitude.toFixed(7)} ${latitude.toFixed(7)}`).join(",")})`;
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
  const [familyFilter, setFamilyFilter] = useState<"all" | Family>("all");
  const [arenaFilter, setArenaFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const svgRef = useRef<SVGSVGElement>(null);

  const selected = routes.find((route) => route.id === selectedId) ?? null;
  const filteredRoutes = useMemo(() => routes.filter((route) =>
    (familyFilter === "all" || route.family === familyFilter)
    && (arenaFilter === "all" || route.arena === arenaFilter)
    && (vehicleFilter === "all" || route.vehicleType === vehicleFilter)
  ), [routes, familyFilter, arenaFilter, vehicleFilter]);
  const viewport = useMemo(() => viewportFor(filteredRoutes.length ? filteredRoutes : routes), [filteredRoutes, routes]);
  const vehicleColor = (route: SavedRoute) => state.vehicleTypes.find((type) => type.name === route.vehicleType)?.color ?? "#8396a4";

  const patch = (id: string, changes: Partial<SavedRoute>) => {
    setRoutes((current) => current.map((route) => route.id === id ? { ...route, ...changes, updatedAt: new Date().toISOString() } : route));
  };

  const addRoute = () => {
    const family: Family = familyFilter === "all" ? "SO" : familyFilter;
    const routeKind: SoRouteKind | "compact" = family === "SI" ? "compact" : "single";
    const route: SavedRoute = {
      id: createId("route"),
      name: "נתיב חדש",
      arena: arenaFilter === "all" ? state.arenas[0] ?? "" : arenaFilter,
      vehicleType: vehicleFilter === "all" ? state.vehicleTypes[0]?.name ?? "" : vehicleFilter,
      family,
      geometry: seedGeometry(family, routeKind, viewport),
      updatedAt: new Date().toISOString(),
      routeKind,
      rotationDeg: 0,
    };
    setRoutes((current) => [...current, route]);
    setSelectedId(route.id);
  };

  const deleteSelected = () => {
    if (!selected) return;
    setRoutes((current) => current.filter((route) => route.id !== selected.id));
    setSelectedId(null);
  };

  const regenerateSelectedShape = (family = selected?.family, routeKind = selected?.routeKind) => {
    if (!selected || !family) return;
    const normalizedKind: SoRouteKind | "compact" = family === "SI" ? "compact" : routeKind === "double" ? "double" : "single";
    patch(selected.id, { family, routeKind: normalizedKind, geometry: seedGeometry(family, normalizedKind, viewport) });
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

  return <section className="glass-panel route-bank-workbench" data-requirements="BW-DEV-002 BW-DEV-003 BW-OFF-005 BW-OFF-006 BW-QA-003" data-testid="route-wkt-workbench">
    <style>{`
      .route-bank-workbench{margin:0 0 16px;padding:18px;border-radius:18px;overflow:hidden}.route-bank-filters{display:grid;grid-template-columns:repeat(3,minmax(150px,1fr)) auto;gap:8px;align-items:end;margin:12px 0}.route-bank-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);gap:16px}.route-bank-map-shell{min-width:0}.route-bank-editor{display:grid;align-content:start;gap:10px;min-width:0}.route-bank-editor label{display:grid;gap:5px;min-width:0}.route-bank-editor input,.route-bank-editor [data-slot="select-trigger"]{width:100%;min-width:0}.route-bank-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.route-bank-actions{display:flex;gap:8px;flex-wrap:wrap}
      @media(max-width:900px){.route-bank-layout{grid-template-columns:1fr}.route-bank-editor{order:-1}.route-bank-filters{grid-template-columns:1fr 1fr}.route-bank-filters>button{width:100%}}
      @media(max-width:600px){.route-bank-workbench{padding:12px}.route-bank-filters,.route-bank-editor-grid{grid-template-columns:1fr}.route-bank-actions{display:grid;grid-template-columns:1fr}.route-bank-actions button{width:100%}.v04-route-bank-map{min-height:280px!important}}
    `}</style>
    <header className="developer-section-header" style={{ marginBottom: 14 }}>
      <div><p className="eyebrow">WGS84 · מקור אמת</p><h2>בנק נתיבים — מפה ועריכה מלאה</h2><p>שם, זירה, משפחה, סוג רכב, סוג SO וה־WKT נשמרים באותה ישות נתיב. גרירה על המפה מזיזה longitude/latitude בפועל.</p></div>
      <div className="header-actions"><Badge variant="outline">{routes.filter((route) => isWkt(route.geometry)).length}/{routes.length} WKT</Badge><Button variant="outline" onClick={addRoute}><Plus />נתיב חדש</Button><Button onClick={saveBank} data-testid="route-wkt-save"><Save />שמור בנק</Button></div>
    </header>
    <div className="route-bank-filters">
      <label><Label>משפחה</Label><Select value={familyFilter} onValueChange={(value) => setFamilyFilter(value as "all" | Family)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">SI + SO</SelectItem><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label>
      <label><Label>זירה</Label><Select value={arenaFilter} onValueChange={setArenaFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל הזירות</SelectItem>{state.arenas.map((arena) => <SelectItem value={arena} key={arena}>{arena}</SelectItem>)}</SelectContent></Select></label>
      <label><Label>סוג רכב</Label><Select value={vehicleFilter} onValueChange={setVehicleFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל סוגי הרכב</SelectItem>{state.vehicleTypes.map((type) => <SelectItem value={type.name} key={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></label>
      <Badge variant="outline">{filteredRoutes.length} נתיבים מוצגים</Badge>
    </div>
    <div className="route-bank-layout">
      <div className="route-bank-map-shell">
        <svg ref={svgRef} data-testid="route-wkt-map" className="v04-route-bank-map" viewBox="0 0 900 460" onPointerMove={moveDrag} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)} style={{ width: "100%", minHeight: 360 }}>
          <defs><pattern id="wkt-grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="currentColor" opacity=".08" /></pattern></defs>
          <rect width="900" height="460" rx="18" /><rect width="900" height="460" fill="url(#wkt-grid)" />
          {filteredRoutes.map((route) => {
            const points = routePoints(route); if (!points) return null;
            const screen = points.map((point) => toSvg(point.longitude, point.latitude, viewport));
            const d = screen.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
            const selectedRoute = route.id === selectedId;
            return <g key={route.id} data-testid={`route-wkt-path-${route.id}`} onPointerDown={(event) => startDrag(event, route)} onClick={() => setSelectedId(route.id)} style={{ cursor: "grab" }}>
              <path data-testid={`route-wkt-hit-${route.id}`} d={d} fill="none" stroke="transparent" strokeWidth="22" pointerEvents="stroke" />
              <path d={d} fill="none" stroke={selectedRoute ? vehicleColor(route) : vehicleColor(route)} strokeWidth={selectedRoute ? 5 : 3} opacity={selectedRoute ? 1 : .62} pointerEvents="none" />
              {selectedRoute && screen[0] && <><circle cx={screen[0].x} cy={screen[0].y} r="7" pointerEvents="none" /><text x={screen[0].x + 12} y={screen[0].y - 10} pointerEvents="none">{route.name}</text></>}
            </g>;
          })}
        </svg>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}><Badge variant="outline">W {viewport.west.toFixed(5)}</Badge><Badge variant="outline">E {viewport.east.toFixed(5)}</Badge><Badge variant="outline">S {viewport.south.toFixed(5)}</Badge><Badge variant="outline">N {viewport.north.toFixed(5)}</Badge></div>
      </div>
      <aside className="route-bank-editor">
        {selected ? <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><MapPinned /><strong>{selected.name}</strong><Badge variant="outline" style={{ borderColor: vehicleColor(selected) }}>{selected.family}</Badge></div>
          <div className="route-bank-editor-grid">
            <label><Label>שם</Label><Input value={selected.name} onChange={(event) => patch(selected.id, { name: event.target.value })} /></label>
            <label><Label>זירה</Label><Select value={selected.arena} onValueChange={(value) => patch(selected.id, { arena: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((arena) => <SelectItem value={arena} key={arena}>{arena}</SelectItem>)}</SelectContent></Select></label>
            <label><Label>סוג רכב</Label><Select value={selected.vehicleType} onValueChange={(value) => patch(selected.id, { vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.vehicleTypes.map((type) => <SelectItem value={type.name} key={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></label>
            <label><Label>משפחה</Label><Select value={selected.family} onValueChange={(value) => regenerateSelectedShape(value as Family, value === "SI" ? "compact" : "single")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label>
            {selected.family === "SO" && <label><Label>סוג SO</Label><Select value={selected.routeKind === "double" ? "double" : "single"} onValueChange={(value) => regenerateSelectedShape("SO", value as SoRouteKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">היפודרום יחיד</SelectItem><SelectItem value="double">היפודרום כפול</SelectItem></SelectContent></Select></label>}
          </div>
          <p className="card-hint">{isWkt(selected.geometry) ? "גרור את הנתיב על המפה או ערוך WKT. שינוי משפחה/סוג מייצר centerline התחלתי חדש במרכז התצוגה." : "זהו נתיב legacy; שמירה דורשת WKT WGS84."}</p>
          <label><Label>WKT · WGS84</Label><Textarea data-testid="route-wkt-input" dir="ltr" rows={9} value={selected.geometry} onChange={(event) => patch(selected.id, { geometry: event.target.value })} /></label>
          <div className="route-bank-actions">{isWkt(selected.geometry) && <Badge variant="outline"><Move /> ניתן לגרירה</Badge>}<Button variant="destructive" onClick={deleteSelected}><Trash2 />מחק נתיב</Button></div>
        </> : <div className="empty-state"><MapPinned /><strong>בחר נתיב על המפה</strong></div>}
      </aside>
    </div>
  </section>;
}
