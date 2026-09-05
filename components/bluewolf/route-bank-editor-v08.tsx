"use client";

import { useRef, useState } from "react";

import type { RouteControlPoint, SavedRoute, VehicleType } from "@/lib/bluewolf";

type Point = RouteControlPoint;

type Props = {
  routes: SavedRoute[];
  vehicleTypes: VehicleType[];
  selectedId: string | null;
  mapLabel?: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onControlPoints: (id: string, points: RouteControlPoint[]) => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function smoothClosedPath(points: Point[]) {
  if (points.length < 3) return "";
  const first = midpoint(points[points.length - 1], points[0]);
  let path = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const mid = midpoint(point, next);
    path += ` Q${point.x.toFixed(2)},${point.y.toFixed(2)} ${mid.x.toFixed(2)},${mid.y.toFixed(2)}`;
  });
  return `${path} Z`;
}

function defaultControlPoints(route: SavedRoute): RouteControlPoint[] {
  if (route.family === "SI") {
    return Array.from({ length: 12 }, (_, index) => {
      const angle = index / 12 * Math.PI * 2;
      return { x: Math.cos(angle) * 48, y: Math.sin(angle) * 48 };
    });
  }

  if (route.routeKind === "double") {
    // One continuous articulated dog-bone loop with a real central waist.
    return [
      { x: -106, y: 0 }, { x: -96, y: -38 }, { x: -66, y: -58 }, { x: -36, y: -50 },
      { x: -17, y: -26 }, { x: 0, y: -8 }, { x: 18, y: -28 }, { x: 39, y: -51 },
      { x: 69, y: -58 }, { x: 99, y: -36 }, { x: 108, y: 2 }, { x: 97, y: 40 },
      { x: 67, y: 59 }, { x: 37, y: 50 }, { x: 17, y: 28 }, { x: 0, y: 9 },
      { x: -18, y: 29 }, { x: -39, y: 51 }, { x: -69, y: 59 }, { x: -99, y: 38 },
    ];
  }

  if (route.routeKind === "figure8" || route.routeKind === "double-figure8") {
    return [
      { x: 0, y: 0 }, { x: 35, y: -38 }, { x: 72, y: -35 }, { x: 92, y: 0 },
      { x: 72, y: 35 }, { x: 35, y: 38 }, { x: 0, y: 0 }, { x: -35, y: -38 },
      { x: -72, y: -35 }, { x: -92, y: 0 }, { x: -72, y: 35 }, { x: -35, y: 38 },
    ];
  }

  return [
    { x: -62, y: -26 }, { x: 0, y: -26 }, { x: 62, y: -26 }, { x: 86, y: 0 },
    { x: 62, y: 26 }, { x: 0, y: 26 }, { x: -62, y: 26 }, { x: -86, y: 0 },
  ];
}

function controlPointsFor(route: SavedRoute) {
  return route.controlPoints && route.controlPoints.length >= 4 ? route.controlPoints : defaultControlPoints(route);
}

export function RouteBankEditorV08({ routes, vehicleTypes, selectedId, mapLabel = "מפת הנדסה", onSelect, onMove, onControlPoints }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragRouteId, setDragRouteId] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ routeId: string; index: number } | null>(null);

  const svgPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 450, y: 230 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width * 900, 0, 900),
      y: clamp((event.clientY - rect.top) / rect.height * 460, 0, 460),
    };
  };

  const localPoint = (event: React.PointerEvent<SVGSVGElement>, route: SavedRoute) => {
    const point = svgPoint(event);
    const centerX = (route.mapX ?? 50) / 100 * 900;
    const centerY = (route.mapY ?? 50) / 100 * 460;
    const radians = -(route.rotationDeg ?? 0) * Math.PI / 180;
    const scale = Math.max(0.2, (route.scalePct ?? 100) / 100);
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: (dx * Math.cos(radians) - dy * Math.sin(radians)) / scale,
      y: (dx * Math.sin(radians) + dy * Math.cos(radians)) / scale,
    };
  };

  const stopDragging = () => {
    setDragRouteId(null);
    setDragPoint(null);
  };

  return <svg
    ref={svgRef}
    className="v04-route-bank-map v08-route-bank-editor"
    viewBox="0 0 900 460"
    role="img"
    aria-label="בנק נתיבים לעריכה באמצעות גרירת הנתיב ונקודות הבקרה"
    onPointerMove={(event) => {
      if (dragPoint) {
        const route = routes.find((item) => item.id === dragPoint.routeId);
        if (!route) return;
        const points = controlPointsFor(route);
        const moved = localPoint(event, route);
        onControlPoints(route.id, points.map((point, index) => index === dragPoint.index ? moved : point));
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
    <rect width="900" height="460" className="v08-route-map-bg" />
    <rect width="900" height="460" fill="url(#v08-route-grid)" className="v08-route-map-grid" />
    <g className="v08-route-map-context" fill="none">
      <path d="M-30 402 C155 300 285 438 448 322 S690 218 940 260" />
      <path d="M38 88 C190 137 333 115 485 66 S724 50 878 106" />
      <path d="M90 290 C215 250 330 260 438 232 S690 170 830 184" />
      <path d="M160 115h105v67H160zM628 300h128v74H628zM742 72h82v54h-82z" />
    </g>
    <g className="v08-route-map-label"><rect x="24" y="20" width="154" height="34" rx="17" /><text x="101" y="42" textAnchor="middle">{mapLabel}</text></g>

    {routes.map((route) => {
      const type = vehicleTypes.find((item) => item.name === route.vehicleType);
      const color = type?.color ?? "#8396a4";
      const x = (route.mapX ?? 50) / 100 * 900;
      const y = (route.mapY ?? 50) / 100 * 460;
      const rotation = route.rotationDeg ?? 0;
      const scale = Math.max(0.2, (route.scalePct ?? 100) / 100);
      const points = controlPointsFor(route);
      const selected = selectedId === route.id;
      return <g
        key={route.id}
        className={`v08-editable-route ${selected ? "selected" : ""}`}
        transform={`translate(${x} ${y}) rotate(${rotation})`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragPoint(null);
          setDragRouteId(route.id);
          onSelect(route.id);
        }}
        onClick={() => onSelect(route.id)}
      >
        <g transform={`scale(${scale})`}>
          <path d={smoothClosedPath(points)} stroke={color} className={route.routeKind === "double" ? "v08-continuous-double" : ""} filter="url(#v08-route-shadow)" />
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
        <g className="v08-route-name" transform={`rotate(${-rotation}) translate(0 ${72 * scale})`}><rect x="-70" y="-14" width="140" height="28" rx="14" /><text y="5" textAnchor="middle">{route.name}</text></g>
      </g>;
    })}
  </svg>;
}
