import type { SiPosition } from "@/lib/bluewolf";

export type SiAdjacentGap = {
  first: number;
  second: number;
  angle: number;
  startDeg: number;
  endDeg: number;
};

function normalize(angle: number) {
  return ((angle % 360) + 360) % 360;
}

/**
 * UI representation of a physical SI arrangement. The Core's complete
 * unordered siPairs contract is intentionally NOT replaced by this view.
 *
 * Sort by bearing, independent of ring and insertion order. Cut the circular
 * ordering across the LARGEST vacant arc, so 0/90/180 is displayed 90,90
 * rather than 90,180, and 300/0/60 is displayed 60,60. A repeated bearing
 * on different rings is a real 0° gap, never an invented 90°/120° relation.
 * The closing gap is not displayed, by product requirement.
 */
export function siAdjacentAngles(positions: readonly Pick<SiPosition, "angleDeg">[]): SiAdjacentGap[] {
  if (positions.length < 2) return [];
  if (positions.some((slot) => !Number.isFinite(slot.angleDeg))) return [];
  const sorted = positions.map((slot, first) => ({ index: first, angle: normalize(slot.angleDeg) }))
    .sort((a, b) => a.angle - b.angle || a.index - b.index);
  const gaps = sorted.map((slot, index) => normalize(sorted[(index + 1) % sorted.length].angle - slot.angle));
  let cut = 0;
  for (let index = 1; index < gaps.length; index += 1) {
    if (gaps[index] > gaps[cut]) cut = index;
  }
  return Array.from({ length: sorted.length - 1 }, (_, offset) => {
    const at = (cut + 1 + offset) % sorted.length;
    const next = (at + 1) % sorted.length;
    return { first: sorted[at].index, second: sorted[next].index, angle: gaps[at], startDeg: sorted[at].angle, endDeg: sorted[next].angle };
  });
}

export function siAdjacentSummary(positions: readonly Pick<SiPosition, "angleDeg">[]) {
  return siAdjacentAngles(positions).map((gap) => gap.angle);
}
