export type Point = { x: number; y: number };
export type DirectedPoint = Point & { heading: number };

export const TAU = Math.PI * 2;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function rotate(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

export function unitFromAngle(degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function normalize(point: Point): Point {
  const length = Math.max(1e-9, Math.hypot(point.x, point.y));
  return { x: point.x / length, y: point.y / length };
}

function add(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(a: Point, value: number): Point { return { x: a.x * value, y: a.y * value }; }

function lineSamples(a: Point, b: Point, count: number, skipFirst = false): Point[] {
  const result: Point[] = [];
  const first = skipFirst ? 1 : 0;
  for (let index = first; index < count; index += 1) {
    const t = index / Math.max(1, count - 1);
    result.push(lerp(a, b, t));
  }
  return result;
}

function quadraticSamples(a: Point, control: Point, b: Point, count: number, skipFirst = true): Point[] {
  const result: Point[] = [];
  for (let index = skipFirst ? 1 : 0; index < count; index += 1) {
    const t = index / Math.max(1, count - 1);
    const s = 1 - t;
    result.push({
      x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
      y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
    });
  }
  return result;
}

/**
 * A mathematically normal hippodrome/stadium.
 * `legLength` is the distance between the two turn centers.
 * The turns are outward semicircles, never inward hooks.
 * legLength=0 degenerates to a circle.
 */
export function hippodromeLoop(center: Point, radius: number, legLength: number, rotationDeg = 0, samples = 144): Point[] {
  const r = Math.max(4, radius);
  const leg = Math.max(0, legLength);
  if (leg < 0.001) {
    return Array.from({ length: samples }, (_, index) => {
      const t = index / samples * TAU;
      return { x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) };
    });
  }
  const u = unitFromAngle(rotationDeg);
  const n = { x: -u.y, y: u.x };
  const a = add(center, scale(u, -leg / 2));
  const b = add(center, scale(u, leg / 2));
  const topA = add(a, scale(n, r));
  const topB = add(b, scale(n, r));
  const bottomB = add(b, scale(n, -r));
  const bottomA = add(a, scale(n, -r));
  const lineCount = Math.max(10, Math.round(samples * 0.23));
  const arcCount = Math.max(18, Math.round(samples * 0.27));
  const points: Point[] = [];
  points.push(...lineSamples(topA, topB, lineCount));
  for (let index = 1; index < arcCount; index += 1) {
    const angle = Math.PI / 2 - Math.PI * index / (arcCount - 1);
    points.push({
      x: b.x + u.x * r * Math.cos(angle) + n.x * r * Math.sin(angle),
      y: b.y + u.y * r * Math.cos(angle) + n.y * r * Math.sin(angle),
    });
  }
  points.push(...lineSamples(bottomB, bottomA, lineCount, true));
  for (let index = 1; index < arcCount; index += 1) {
    const angle = -Math.PI / 2 + Math.PI * index / (arcCount - 1);
    points.push({
      x: a.x - u.x * r * Math.cos(angle) + n.x * r * Math.sin(angle),
      y: a.y - u.y * r * Math.cos(angle) + n.y * r * Math.sin(angle),
    });
  }
  return points;
}

/**
 * One continuous articulated Double SO route.
 * It is equivalent to two hippodrome legs joined at a central bend, but the
 * inner U-turns are removed. Only the two OUTER ends turn around.
 */
export function doubleHippodromeLoop(
  center: Point,
  radius: number,
  leftLeg: number,
  rightLeg: number,
  bendDeg = 28,
  rotationDeg = -10,
): Point[] {
  const r = Math.max(5, radius);
  const legA = Math.max(18, leftLeg);
  const legB = Math.max(18, rightLeg);
  const u1 = unitFromAngle(rotationDeg);
  const n1 = { x: -u1.y, y: u1.x };
  const u2 = unitFromAngle(rotationDeg + bendDeg);
  const n2 = { x: -u2.y, y: u2.x };
  const outerA = add(center, scale(u1, -legA));
  const outerB = add(center, scale(u2, legB));
  const topA = add(outerA, scale(n1, r));
  const topJ1 = add(center, scale(n1, r));
  const topJ2 = add(center, scale(n2, r));
  const topB = add(outerB, scale(n2, r));
  const bottomB = add(outerB, scale(n2, -r));
  const bottomJ2 = add(center, scale(n2, -r));
  const bottomJ1 = add(center, scale(n1, -r));
  const bottomA = add(outerA, scale(n1, -r));
  const averageNormal = normalize(add(n1, n2));
  const topControl = add(center, scale(averageNormal, r * 1.28));
  const bottomControl = add(center, scale(averageNormal, -r * 1.28));
  const points: Point[] = [];
  points.push(...lineSamples(topA, topJ1, 20));
  points.push(...quadraticSamples(topJ1, topControl, topJ2, 12));
  points.push(...lineSamples(topJ2, topB, 20, true));
  for (let index = 1; index < 34; index += 1) {
    const angle = Math.PI / 2 - Math.PI * index / 33;
    points.push({
      x: outerB.x + u2.x * r * Math.cos(angle) + n2.x * r * Math.sin(angle),
      y: outerB.y + u2.y * r * Math.cos(angle) + n2.y * r * Math.sin(angle),
    });
  }
  points.push(...lineSamples(bottomB, bottomJ2, 20, true));
  points.push(...quadraticSamples(bottomJ2, bottomControl, bottomJ1, 12));
  points.push(...lineSamples(bottomJ1, bottomA, 20, true));
  for (let index = 1; index < 34; index += 1) {
    const angle = -Math.PI / 2 + Math.PI * index / 33;
    points.push({
      x: outerA.x - u1.x * r * Math.cos(angle) + n1.x * r * Math.sin(angle),
      y: outerA.y - u1.y * r * Math.cos(angle) + n1.y * r * Math.sin(angle),
    });
  }
  return points;
}

export function figureEightLoop(center: Point, radius: number, legLength: number, rotationDeg = 0, samples = 160): Point[] {
  const sx = Math.max(radius * 1.45, legLength / 2 + radius);
  const sy = Math.max(radius * 0.9, 18);
  return Array.from({ length: samples }, (_, index) => {
    const t = index / samples * TAU;
    const local = { x: sx * Math.sin(t), y: sy * Math.sin(2 * t) };
    return rotate(add(center, local), center, rotationDeg);
  });
}

export function svgClosedPath(points: Point[]) {
  if (!points.length) return "";
  return `M${points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" L")} Z`;
}

export function pointOnClosed(points: Point[], phase: number): DirectedPoint {
  if (!points.length) return { x: 0, y: 0, heading: 0 };
  const p = ((phase % 1) + 1) % 1;
  const lengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let target = p * total;
  for (let index = 0; index < points.length; index += 1) {
    const segment = lengths[index];
    if (target <= segment || index === points.length - 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const t = clamp(target / Math.max(segment, 1e-9), 0, 1);
      const point = lerp(a, b, t);
      return { ...point, heading: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90 };
    }
    target -= segment;
  }
  return { ...points[0], heading: 0 };
}

export type ParametricGeometry = {
  centerX: number;
  centerY: number;
  radius: number;
  legLength: number;
  rotationDeg: number;
  figure8?: boolean;
  secondLegLength?: number;
  bendDeg?: number;
};

export function geometryPoints(kind: "circle" | "single" | "double" | "figure8", geometry: ParametricGeometry): Point[] {
  const center = { x: geometry.centerX, y: geometry.centerY };
  if (kind === "circle") return hippodromeLoop(center, geometry.radius, 0, geometry.rotationDeg);
  if (kind === "figure8" || geometry.figure8) return figureEightLoop(center, geometry.radius, geometry.legLength, geometry.rotationDeg);
  if (kind === "double") return doubleHippodromeLoop(center, geometry.radius, geometry.legLength, geometry.secondLegLength ?? geometry.legLength, geometry.bendDeg ?? 28, geometry.rotationDeg);
  return hippodromeLoop(center, geometry.radius, geometry.legLength, geometry.rotationDeg);
}

export function scoreColor(score: number) {
  if (score >= 80) return "#22b986";
  if (score >= 50) return "#f3a31b";
  return "#e45f62";
}
