import type { SoRouteKind } from "@/lib/bluewolf";

/**
 * GEO-01 / GEO-02 source of truth for SO rendering and motion.
 *
 * Geometry is deliberately independent of vehicle type. The same transformed
 * centerline is consumed by the template generator, previews and live map.
 * A Double is one continuous elongated hippodrome; it is never composed from
 * two overlapping capsules and therefore has no internal U-turn.
 */
export type SoPoint = { x: number; y: number };
export type SoPointWithHeading = SoPoint & { heading: number };
export type SoSmilePose = {
  routeIndex: number;
  rotationDeg: number;
  offsetX: number;
  offsetY: number;
};
export type SoRouteGeometry = {
  routeIndex: number;
  kind: SoRouteKind;
  center: SoPoint;
  rotationDeg: number;
  points: SoPoint[];
  path: string;
};

export type SoGeometryOptions = {
  centerX?: number;
  centerY?: number;
  spacing?: number;
  risePerStep?: number;
  radius?: number;
  singleHalfLeg?: number;
  doubleHalfLeg?: number;
  samplesPerTurn?: number;
};

export const SO_DIRECT_PHASES: Record<SoRouteKind, readonly number[]> = {
  single: [0, 0.5],
  double: [0, 0.25, 0.5, 0.75],
};

export function soSmilePoses(count: number, spacing = 245, risePerStep = 22): SoSmilePose[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, routeIndex) => {
    const relative = routeIndex - center;
    return {
      routeIndex,
      rotationDeg: relative * 30,
      offsetX: relative * spacing,
      // A symmetric shallow smile. Odd layouts have one horizontal center;
      // even layouts are mirrored around the horizontal axis with no fake center.
      offsetY: Math.abs(relative) * Math.abs(relative) * risePerStep,
    };
  });
}

function rotate(point: SoPoint, degrees: number): SoPoint {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function transform(point: SoPoint, pose: SoSmilePose, center: SoPoint): SoPoint {
  const rotated = rotate(point, pose.rotationDeg);
  return { x: center.x + pose.offsetX + rotated.x, y: center.y + pose.offsetY + rotated.y };
}

/** Closed clockwise hippodrome polyline with straight legs and only outer turns. */
export function localHippodromePoints(
  kind: SoRouteKind,
  {
    radius = 22,
    singleHalfLeg = 54,
    doubleHalfLeg = 104,
    samplesPerTurn = 18,
  }: Pick<SoGeometryOptions, "radius" | "singleHalfLeg" | "doubleHalfLeg" | "samplesPerTurn"> = {},
): SoPoint[] {
  const halfLeg = kind === "double" ? doubleHalfLeg : singleHalfLeg;
  const samples = Math.max(6, Math.round(samplesPerTurn));
  const points: SoPoint[] = [{ x: -halfLeg, y: -radius }, { x: halfLeg, y: -radius }];

  for (let index = 1; index <= samples; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / samples;
    points.push({ x: halfLeg + Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  points.push({ x: -halfLeg, y: radius });

  // Closing is left to SVG Z / the sampler, so the initial point is not duplicated.
  for (let index = 1; index < samples; index += 1) {
    const angle = Math.PI / 2 + index * Math.PI / samples;
    points.push({ x: -halfLeg + Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

export function pointsToClosedPath(points: readonly SoPoint[]) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" ") + " Z";
}

function fittedShapeOptions(options: SoGeometryOptions, spacing: number) {
  const radius = options.radius ?? 22;
  const singleHalfLeg = options.singleHalfLeg ?? 54;
  const doubleHalfLeg = options.doubleHalfLeg ?? 104;
  // Keep a visible gap of roughly half a single half-leg. If a caller requests a
  // compact layout, scale all routes uniformly instead of allowing overlap.
  const desiredGap = Math.max(8, singleHalfLeg * 0.5);
  const nominalExtent = Math.hypot(doubleHalfLeg + radius, radius);
  const availableExtent = Math.max(8, (spacing - desiredGap) / 2);
  const scale = Math.min(1, availableExtent / nominalExtent);
  return {
    radius: radius * scale,
    singleHalfLeg: singleHalfLeg * scale,
    doubleHalfLeg: doubleHalfLeg * scale,
    samplesPerTurn: options.samplesPerTurn,
  };
}

export function buildSoSmileGeometry(chain: readonly SoRouteKind[], options: SoGeometryOptions = {}): SoRouteGeometry[] {
  const center = { x: options.centerX ?? 0, y: options.centerY ?? 0 };
  const spacing = options.spacing ?? 245;
  const poses = soSmilePoses(chain.length, spacing, options.risePerStep ?? 22);
  const shapeOptions = fittedShapeOptions(options, spacing);
  return chain.map((kind, routeIndex) => {
    const pose = poses[routeIndex];
    const local = localHippodromePoints(kind, shapeOptions);
    const points = local.map((point) => transform(point, pose, center));
    return {
      routeIndex,
      kind,
      center: { x: center.x + pose.offsetX, y: center.y + pose.offsetY },
      rotationDeg: pose.rotationDeg,
      points,
      path: pointsToClosedPath(points),
    };
  });
}

function distance(first: SoPoint, second: SoPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizedPhase(value: number) {
  return ((value % 1) + 1) % 1;
}

/** Sample the same physical route used for rendering and return its tangent heading. */
export function pointAtSoPhase(points: readonly SoPoint[], phase: number, reverse = false): SoPointWithHeading {
  if (points.length < 2) throw new Error("SO geometry requires at least two points");
  const closed = [...points, points[0]];
  const lengths = closed.slice(1).map((point, index) => distance(closed[index], point));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  const basePhase = normalizedPhase(phase);
  const directedPhase = reverse ? normalizedPhase(1 - basePhase) : basePhase;
  let remaining = directedPhase * perimeter;

  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index];
    if (remaining <= segment || index === lengths.length - 1) {
      const start = closed[index];
      const end = closed[index + 1];
      const ratio = segment > 0 ? Math.min(1, Math.max(0, remaining / segment)) : 0;
      const x = start.x + (end.x - start.x) * ratio;
      const y = start.y + (end.y - start.y) * ratio;
      const tangentX = reverse ? start.x - end.x : end.x - start.x;
      const tangentY = reverse ? start.y - end.y : end.y - start.y;
      return { x, y, heading: Math.atan2(tangentY, tangentX) * 180 / Math.PI + 90 };
    }
    remaining -= segment;
  }

  const first = closed[0];
  const next = closed[1];
  return { x: first.x, y: first.y, heading: Math.atan2(next.y - first.y, next.x - first.x) * 180 / Math.PI + 90 };
}

export function soPhasesForRoute(kind: SoRouteKind) {
  return SO_DIRECT_PHASES[kind];
}

/** Gap between route centerlines. Positive means the two rendered routes do not touch. */
export function minimumRouteGap(first: SoRouteGeometry, second: SoRouteGeometry) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const left of first.points) {
    for (const right of second.points) minimum = Math.min(minimum, distance(left, right));
  }
  return minimum;
}
