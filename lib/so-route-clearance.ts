/** Exact segment-wise clearance for closed SO outlines (screen-coordinate metres/pixels).
 * A zero result means two boundaries intersect/touch, one closed route contains
 * the other, or an input cannot represent a valid closed area. Never infer
 * clearance from the distance between sampled vertices.
 */
export type OutlinePoint = { x: number; y: number };

const EPSILON = 1e-9;

function cross(a: OutlinePoint, b: OutlinePoint, c: OutlinePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: OutlinePoint, b: OutlinePoint, p: OutlinePoint) {
  return Math.abs(cross(a, b, p)) <= EPSILON
    && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

function intersects(a: OutlinePoint, b: OutlinePoint, c: OutlinePoint, d: OutlinePoint) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if ((abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON)
    && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON)) return true;
  return Math.abs(abC) <= EPSILON && onSegment(a, b, c)
    || Math.abs(abD) <= EPSILON && onSegment(a, b, d)
    || Math.abs(cdA) <= EPSILON && onSegment(c, d, a)
    || Math.abs(cdB) <= EPSILON && onSegment(c, d, b);
}

function pointSegmentSquared(p: OutlinePoint, a: OutlinePoint, b: OutlinePoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON * EPSILON) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

/** A triangle count alone does not make a valid closed route: reject collinear
 * or fully repeated samples before interpreting a positive separation as safe. */
function hasClosedArea(outline: readonly OutlinePoint[]): boolean {
  const origin = outline[0];
  let twiceArea = 0;
  for (let index = 1; index < outline.length - 1; index += 1) {
    twiceArea += cross(origin, outline[index], outline[index + 1]);
  }
  return Number.isFinite(twiceArea) && Math.abs(twiceArea) > EPSILON;
}

/** Returns true for strict containment; boundaries were checked beforehand. */
function inside(p: OutlinePoint, outline: readonly OutlinePoint[]) {
  let contained = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index, index += 1) {
    const a = outline[previous];
    const b = outline[index];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (x > p.x) contained = !contained;
    }
  }
  return contained;
}

export function closedOutlineClearance(first: readonly OutlinePoint[], second: readonly OutlinePoint[]): number {
  if (first.length < 3 || second.length < 3) return 0;
  if (![...first, ...second].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return 0;
  if (!hasClosedArea(first) || !hasClosedArea(second)) return 0;
  let minimumSquared = Number.POSITIVE_INFINITY;
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = first[(i + 1) % first.length];
    for (let j = 0; j < second.length; j += 1) {
      const c = second[j];
      const d = second[(j + 1) % second.length];
      if (intersects(a, b, c, d)) return 0;
      minimumSquared = Math.min(minimumSquared, pointSegmentSquared(a, c, d), pointSegmentSquared(b, c, d), pointSegmentSquared(c, a, b), pointSegmentSquared(d, a, b));
    }
  }
  if (inside(first[0], second) || inside(second[0], first)) return 0;
  return Math.sqrt(minimumSquared);
}
