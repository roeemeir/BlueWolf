"use client";

import { useMemo, useRef, useState } from "react";

import type { RouteControlPoint, SavedRoute, VehicleType } from "@/lib/bluewolf";

type Point = RouteControlPoint;

type Props = {
  routes: SavedRoute[];
  vehicleTypes: VehicleType[];
  selectedId: string | null;
  mapLabel?: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onControlPoints: (id: string, controlPoints: RouteControlPoint[]) => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function rotate(point: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function defaultControlPoints(route: SavedRoute): Point[] {
  if (route.family === "SI") {
    return Array.from({ length: 12 }, (_, index) => {
      const angle = index / 12 * Math.PI * 2;
      return { x: Math.cos(angle) * 70, y: Math.sin(angle) * 70 };
    });
  }
  if (route.routeKind === "double") {
    return [
      { x: -145, y: 15 }, { x: -135, y: -43 }, { x: -88, y: -70 }, { x: -45, y: -48 }, { x: -12, y: -14 },
      { x: 14, y: -31 }, { x: 54, y: -66 }, { x: 103, y: -70 }, { x: 145, y: -36 }, { x: 153, y: 12 },
      { x: 137, y: 55 }, { x: 91, y: 71 }, { x: 48, y: 49 }, { x: 12, y: 16 }, { x: -18, y: 35 },
      { x: -62, y: 72 }, { x: -108, y: 68 }, { x: -142, y: 43 },
    ];
  }
  if (route.routeKind === "figure8") {
    return Array.from({ length: 16 }, (_, index) => {
      const t = index / 16 * Math.PI * 2;
      return { x: Math.sin(t) * 105, y: Math.sin(2 * t) * 50 };
    });
  }
  return [
    { x: -104, y: -32 }, { x: -62, y: -58 }, { x: 62, y: -58 }, { x: 104, y: -32 },
    { x: 104, y: 32 }, { x: 62, y: 58 }, { x: -62, y: 58 }, { x: -104, y: 32 },
  ];
}

function controlPointsFor(route: SavedRoute) {
  return route.controlPoints?.length && route.controlPoints.length >= 4 ? route.controlPoints : defaultControlPoints(route);
}

function smoothClosedPath(points: Point[]) {
  if (points.length < 2) return "";
  const path = [`M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const previous = points[(index - 1 + points.length) % points.length];
    const after = points[(index + 2) % points.length];
    const c1 = { x: current.x + (next.x - previous.x) / 6, y: current.y + (next.y - previous.y) / 6 };
    const c2 = { x: next.x - (after.x - current.x) / 6, y: next.y - (after.y - current.y) / 6 };
    path.push(`C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`);
  }
  path.push("Z");
  return path.join(" ");
}

export function RouteBankEditorV08({ routes, vehicleTypes, selectedId, mapLabel = "מפה הנדסית", onSelect, onMove, onControlPoints }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragRouteId, setDragRouteId] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ routeId: string; index: number } | null>(null);
  const routeById = useMemo(() => new Map(routes.map((route) => [route.id, route])), [routes]);

  const svgPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) / Math.max(rect.width, 1) * 900,
      y: (event.clientY - rect.top) / Math.max(rect.height, 1) * 460,
    };
  };

  const stopDragging = () => {
    setDragRouteId(null);
    setDragPoint(null);
  };

  return <svg
    ref={svgRef}
    className="v08-route-bank-editor v04-route-bank-map"
    viewBox="0 0 900 460"
    role="img"
    aria-label="מפת בנק נתיבים עם נקודות עריכה נגררות"
    onPointerMove={(event) => {
      if (dragPoint) {
        const route = routeById.get(dragPoint.routeId);
        if (!route) return;
        const point = svgPoint(event);
        const center = { x: (route.mapX ?? 50) / 100 * 900, y: (route.mapY ?? 50) / 100 * 460 };
        const scale = Math.max(0.2, (route.scalePct ?? 100) / 100);
        const local = rotate({ x: (point.x - center.x) / scale, y: (point.y - center.y) / scale }, -(route.rotationDeg ?? 0));
        const next = controlPointsFor(route).map((item, index) => index === dragPoint.index ? { x: clamp(local.x, -240, 240), y: clamp(local.y, -180, 180) } : item);
        onControlPoints(route.id, next);
        return;
      }
      if (!dragRouteId) return;
      const point = svgPoint(event);
      onMove(dragRouteId, clamp(point.x / 9, 5, 95), clamp(point.y / 4.6, 8, 92));
    }}
    onPointerUp={stopDragging}
    onPointerCancel={stopDragging}
    onPointerLeave={stopDragging}
  >
    <defs>
      <pattern id="v08-route-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" /></pattern>
      <filter id="v08-route-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity=".18" /></filter>
    </defs>
    <rect width="900" height="460" className="v08-route-map-bg" pointerEvents="none" />
    <rect width="900" height="460" fill="url(#v08-route-grid)" className="v08-route-map-grid" pointerEvents="none" />
    <g className="v08-route-map-context" fill="none" pointerEvents="none">
      <path d="M-30 402 C155 300 285 438 448 322 S690 218 940 260" />
      <path d="M38 88 C190 137 333 115 485 66 S724 50 878 106" />
      <path d="M90 290 C215 250 330 260 438 232 S690 170 830 184" />
      <path d="M160 115h105v67H160zM628 300h128v74H628zM742 72h82v54h-82z" />
    </g>
    <g className="v08-route-map-label" pointerEvents="none"><rect x="24" y="20" width="154" height="34" rx="17" /><text x="101" y="42" textAnchor="middle">{mapLabel}</text></g>

    {routes.map((route) => {
      const type = vehicleTypes.find((item) => item.name === route.vehicleType);
      const color = type?.color ?? "#8396a4";
      const x = (route.mapX ?? 50) / 100 * 900;
      const y = (route.mapY ?? 50) / 100 * 460;
      const rotation = route.rotationDeg ?? 0;
      const scale = Math.max(0.2, (route.scalePct ?? 100) / 100);
      const points = controlPointsFor(route);
      const path = smoothClosedPath(points);
      const selected = selectedId === route.id;
      return <g
        key={route.id}
        className={`v08-editable-route ${selected ? "selected" : ""}`}
        transform={`translate(${x} ${y}) rotate(${rotation})`}
        onClick={() => onSelect(route.id)}
      >
        <g transform={`scale(${scale})`}>
          <path
            d={path}
            className="v08-route-hit"
            fill="none"
            stroke="transparent"
            strokeWidth={24 / scale}
            pointerEvents="stroke"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragPoint(null);
              setDragRouteId(route.id);
              onSelect(route.id);
            }}
          />
          <path d={path} stroke={color} className={route.routeKind === "double" ? "v08-continuous-double" : ""} filter="url(#v08-route-shadow)" pointerEvents="none" />
          {selected && points.map((point, index) => <circle
            key={`${route.id}-${index}`}
            className="v08-control-point"
            cx={point.x}
            cy={point.y}
            r={6 / scale}
            stroke={color}
            tabIndex={0}
            role="button"
            aria-label={`נקודת עריכה ${index + 1} בנתיב ${route.name}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragRouteId(null);
              setDragPoint({ routeId: route.id, index });
            }}
          />)}
        </g>
        <g className="v08-route-name" transform={`rotate(${-rotation}) translate(0 ${72 * scale})`} pointerEvents="none"><rect x="-70" y="-14" width="140" height="28" rx="14" /><text y="5" textAnchor="middle">{route.name}</text></g>
      </g>;
    })}
  </svg>;
}
