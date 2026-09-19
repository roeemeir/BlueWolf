import type { SoRouteKind } from "@/lib/bluewolf";

/** GEO-01/GEO-02: identical physical geometry for the SO generator, preview and live simulation. */
export type SoPoint = { x: number; y: number };
export type SoPointWithHeading = SoPoint & { heading: number };
export type SoSmilePose = { routeIndex: number; rotationDeg: number; offsetX: number; offsetY: number };
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

export const DOUBLE_HIPPODROME_BREAK_DEG = 30;
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
      offsetY: Math.abs(relative) * Math.abs(relative) * risePerStep,
    };
  });
}

/** A Double occupies two consecutive physical hippodrome slots in the 30-degree chain. */
export function soSmileChainPoses(
  chain: readonly SoRouteKind[],
  spacing = 245,
  risePerStep = 22,
): SoSmilePose[] {
  if (!chain.length) return [];
  const spans = chain.map((kind) => kind === "double" ? 2 : 1);
  const totalUnits = spans.reduce((sum, value) => sum + value, 0);
  const unitCenter = (totalUnits - 1) / 2;
  let cursor = 0;
  return spans.map((span, routeIndex) => {
    const routeUnitCenter = cursor + (span - 1) / 2;
    const relative = routeUnitCenter - unitCenter;
    cursor += span;
    return {
      routeIndex,
      rotationDeg: relative * 30,
      offsetX: relative * spacing,
      offsetY: relative * relative * risePerStep,
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

function singleHippodromePoints(radius: number, halfLeg: number, samples: number): SoPoint[] {
  const points: SoPoint[] = [{ x: -halfLeg, y: -radius }, { x: halfLeg, y: -radius }];
  for (let index = 1; index <= samples; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / samples;
    points.push({ x: halfLeg + Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  points.push({ x: -halfLeg, y: radius });
  for (let index = 1; index < samples; index += 1) {
    const angle = Math.PI / 2 + index * Math.PI / samples;
    points.push({ x: -halfLeg + Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

/**
 * A continuous Double, with an inverted-V centerline in screen coordinates:
 * left endpoint BELOW the center, right endpoint BELOW the center. The physical
 * axes read left-to-right as -15° then +15°, matching the neighboring Singles
 * in the global concave smile. The previous +15°/-15° ordering drew a local V.
 */
function bentDoubleHippodromePoints(radius: number, segmentLength: number, samples: number): SoPoint[] {
  const halfBreak = DOUBLE_HIPPODROME_BREAK_DEG / 2 * Math.PI / 180;
  const tangentLeft = { x: Math.cos(halfBreak), y: -Math.sin(halfBreak) };
  const tangentRight = { x: Math.cos(halfBreak), y: Math.sin(halfBreak) };
  const normalLeft = { x: -tangentLeft.y, y: tangentLeft.x };
  const normalRight = { x: -tangentRight.y, y: tangentRight.x };
  const leftEnd = { x: -segmentLength * tangentLeft.x, y: -segmentLength * tangentLeft.y };
  const joint = { x: 0, y: 0 };
  const rightEnd = { x: segmentLength * tangentRight.x, y: segmentLength * tangentRight.y };
  const offset = (point: SoPoint, normal: SoPoint, amount: number): SoPoint => ({
    x: point.x + normal.x * amount, y: point.y + normal.y * amount,
  });

  const points: SoPoint[] = [
    offset(leftEnd, normalLeft, radius),
    offset(joint, normalLeft, radius),
    offset(joint, normalRight, radius),
    offset(rightEnd, normalRight, radius),
  ];

  const rightNormalAngle = Math.atan2(normalRight.y, normalRight.x);
  for (let index = 1; index <= samples; index += 1) {
    const angle = rightNormalAngle - index * Math.PI / samples;
    points.push({ x: rightEnd.x + Math.cos(angle) * radius, y: rightEnd.y + Math.sin(angle) * radius });
  }
  points.push(
    offset(joint, normalRight, -radius),
    offset(joint, normalLeft, -radius),
    offset(leftEnd, normalLeft, -radius),
  );

  const negativeLeftNormalAngle = Math.atan2(-normalLeft.y, -normalLeft.x);
  for (let index = 1; index < samples; index += 1) {
    const angle = negativeLeftNormalAngle - index * Math.PI / samples;
    points.push({ x: leftEnd.x + Math.cos(angle) * radius, y: leftEnd.y + Math.sin(angle) * radius });
  }
  return points;
}

export function localHippodromePoints(
  kind: SoRouteKind,
  {
    radius = 22,
    singleHalfLeg = 54,
    doubleHalfLeg = 104,
    samplesPerTurn = 18,
  }: Pick<SoGeometryOptions, "radius" | "singleHalfLeg" | "doubleHalfLeg" | "samplesPerTurn"> = {},
): SoPoint[] {
  const samples = Math.max(6, Math.round(samplesPerTurn));
  return kind === "double"
    ? bentDoubleHippodromePoints(radius, doubleHalfLeg, samples)
    : singleHippodromePoints(radius, singleHalfLeg, samples);
}

export function pointsToClosedPath(points: readonly SoPoint[]) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" ") + " Z";
}

function fittedShapeOptions(options: SoGeometryOptions, spacing: number, chain: readonly SoRouteKind[], poses: readonly SoSmilePose[]) {
  const radius = options.radius ?? 22;
  const singleHalfLeg = options.singleHalfLeg ?? 54;
  const doubleHalfLeg = options.doubleHalfLeg ?? 104;
  // Fit neighboring physical outlines rather than assuming that every route has
  // the extent of a Double. This keeps mixed chains compact without overlapping.
  const extent = (kind: SoRouteKind) => kind === "double"
    ? doubleHalfLeg + radius
    : singleHalfLeg + radius;
  let scale = 1;
  for (let index = 1; index < chain.length; index += 1) {
    const previous = poses[index - 1];
    const current = poses[index];
    const centerDistance = Math.hypot(current.offsetX - previous.offsetX, current.offsetY - previous.offsetY);
    const combinedExtent = extent(chain[index - 1]) + extent(chain[index]);
    // Leave a small physical buffer, not the former half-leg-wide gap.
    scale = Math.min(scale, Math.max(0.05, (centerDistance - 7) / combinedExtent));
  }
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
  const poses = soSmileChainPoses(chain, spacing, options.risePerStep ?? 22);
  const shapeOptions = fittedShapeOptions(options, spacing, chain, poses);
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

/** Sample the rendered physical outline; reversing negates heading but not position. */
export function pointAtSoPhase(points: readonly SoPoint[], phase: number, reverse = false): SoPointWithHeading {
  if (points.length < 2) throw new Error("SO geometry requires at least two points");
  const closed = [...points, points[0]];
  const lengths = closed.slice(1).map((point, index) => distance(closed[index], point));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  let remaining = normalizedPhase(phase) * perimeter;

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
  const tangentX = reverse ? first.x - next.x : next.x - first.x;
  const tangentY = reverse ? first.y - next.y : next.y - first.y;
  return { x: first.x, y: first.y, heading: Math.atan2(tangentY, tangentX) * 180 / Math.PI + 90 };
}

export function soPhasesForRoute(kind: SoRouteKind) {
  return SO_DIRECT_PHASES[kind];
}

/** Closest sampled points on two physical outlines (positive when they do not touch). */
export function minimumRouteGap(first: SoRouteGeometry, second: SoRouteGeometry) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const left of first.points) {
    for (const right of second.points) minimum = Math.min(minimum, distance(left, right));
  }
  return minimum;
}
