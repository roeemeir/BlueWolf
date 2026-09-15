import type { SoRelation, SoRouteKind } from "@/lib/bluewolf";
import { SO_DIRECT_PHASES } from "@/lib/so-geometry";

export { soPhasesForRoute, soSmilePoses, type SoSmilePose } from "@/lib/so-geometry";

export type SoDirection = "forward" | "reverse";

export type SoDirectPlacement = {
  routeIndex: number;
  phase: number;
  typeId: string;
  direction: SoDirection;
};

function key(chain: readonly SoRouteKind[]) {
  return chain.join("-");
}

export function canonicalSoOrderKey(chain: readonly SoRouteKind[]) {
  const forward = key(chain);
  const reversed = key([...chain].reverse());
  return forward < reversed ? forward : reversed;
}

export function directSoPlacementKey(chain: readonly SoRouteKind[], placements: readonly SoDirectPlacement[]) {
  const placementKey = placements
    .map((item) => `${item.routeIndex}:${normalizePhase(item.phase)}:${item.typeId}:${item.direction}`)
    .sort()
    .join("|");
  return `${key(chain)}|${placementKey}`;
}

export function generateUniqueSoOrders(singleCount: number, doubleCount: number) {
  if (!Number.isInteger(singleCount) || singleCount < 0 || !Number.isInteger(doubleCount) || doubleCount < 0) {
    throw new Error("SO counts must be non-negative integers");
  }
  const total = singleCount + doubleCount;
  if (total < 1) return [];
  if (total > 10) throw new Error("SO order generator is limited to 10 route instances");

  const results = new Map<string, SoRouteKind[]>();
  const visit = (prefix: SoRouteKind[], singlesLeft: number, doublesLeft: number) => {
    if (singlesLeft === 0 && doublesLeft === 0) {
      const canonical = canonicalSoOrderKey(prefix);
      if (!results.has(canonical)) results.set(canonical, [...prefix]);
      return;
    }
    if (singlesLeft > 0) visit([...prefix, "single"], singlesLeft - 1, doublesLeft);
    if (doublesLeft > 0) visit([...prefix, "double"], singlesLeft, doublesLeft - 1);
  };
  visit([], singleCount, doubleCount);
  return [...results.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

function normalizePhase(value: number) {
  const normalized = ((value % 1) + 1) % 1;
  return Math.round(normalized * 1000) / 1000;
}

export function placeSoVehicle(
  placements: readonly SoDirectPlacement[],
  chain: readonly SoRouteKind[],
  routeIndex: number,
  phase: number,
  typeId: string,
): { ok: true; placements: SoDirectPlacement[] } | { ok: false; reason: "invalid-route" | "invalid-phase" | "slot-occupied" | "vehicle-type-required" } {
  const kind = chain[routeIndex];
  if (!kind) return { ok: false, reason: "invalid-route" };
  const normalized = normalizePhase(phase);
  if (!SO_DIRECT_PHASES[kind].includes(normalized)) return { ok: false, reason: "invalid-phase" };
  if (!typeId.trim()) return { ok: false, reason: "vehicle-type-required" };
  if (placements.some((item) => item.routeIndex === routeIndex && normalizePhase(item.phase) === normalized)) {
    return { ok: false, reason: "slot-occupied" };
  }
  return {
    ok: true,
    placements: [...placements, { routeIndex, phase: normalized, typeId, direction: "forward" }],
  };
}

export function removeSoVehicle(placements: readonly SoDirectPlacement[], routeIndex: number, phase: number) {
  const normalized = normalizePhase(phase);
  return placements.filter((item) => !(item.routeIndex === routeIndex && normalizePhase(item.phase) === normalized));
}

export function toggleSoVehicleDirection(placements: readonly SoDirectPlacement[], routeIndex: number, phase: number) {
  const normalized = normalizePhase(phase);
  return placements.map((item) => item.routeIndex === routeIndex && normalizePhase(item.phase) === normalized
    ? { ...item, direction: item.direction === "forward" ? "reverse" as const : "forward" as const }
    : item);
}

function semanticQuarter(placement: SoDirectPlacement) {
  const quarter = Math.round(normalizePhase(placement.phase) * 4) % 4;
  return placement.direction === "forward" ? quarter : (4 - quarter) % 4;
}

function quarterSet(placements: readonly SoDirectPlacement[], routeIndex: number) {
  return [...new Set(placements.filter((item) => item.routeIndex === routeIndex).map(semanticQuarter))].sort((a, b) => a - b);
}

function arraysEqual(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function deriveSoRelation(placements: readonly SoDirectPlacement[], firstRouteIndex: number, secondRouteIndex: number): SoRelation {
  const first = quarterSet(placements, firstRouteIndex);
  const second = quarterSet(placements, secondRouteIndex);
  if (!first.length || !second.length) return "mixed";
  if (arraysEqual(first, second)) return "same";
  const opposite = first.map((quarter) => (quarter + 2) % 4).sort((a, b) => a - b);
  if (arraysEqual(opposite, second)) return "opposite";
  return "mixed";
}

export function deriveSoRelations(chain: readonly SoRouteKind[], placements: readonly SoDirectPlacement[]) {
  return chain.slice(0, -1).map((_, routeIndex) => deriveSoRelation(placements, routeIndex, routeIndex + 1));
}

export function validateSoPlacements(chain: readonly SoRouteKind[], placements: readonly SoDirectPlacement[]) {
  const occupied = new Set<string>();
  for (const placement of placements) {
    const kind = chain[placement.routeIndex];
    if (!kind) return `SO placement references missing route ${placement.routeIndex}`;
    const phase = normalizePhase(placement.phase);
    if (!SO_DIRECT_PHASES[kind].includes(phase)) return `SO phase ${phase} is invalid for ${kind}`;
    if (!placement.typeId.trim()) return "SO placement requires vehicle type";
    const slot = `${placement.routeIndex}:${phase}`;
    if (occupied.has(slot)) return `SO slot ${slot} is occupied more than once`;
    occupied.add(slot);
  }
  return null;
}
