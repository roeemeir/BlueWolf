import {
  SI_POSITION_ANGLES,
  type RingRole,
  type SiPairRule,
  type SiPosition,
  type VehicleType,
} from "@/lib/bluewolf";

export type SiPlacementResult =
  | { ok: true; positions: SiPosition[] }
  | { ok: false; reason: "invalid-angle" | "ring-not-allowed" | "slot-occupied" | "max-vehicles" };

export const SI_DIRECT_MAX_VEHICLES = 5;

function normalizedAngle(angleDeg: number) {
  return ((angleDeg % 360) + 360) % 360;
}

export function placeSiVehicle(
  positions: readonly SiPosition[],
  vehicleType: Pick<VehicleType, "id" | "siRoles">,
  ring: RingRole,
  angleDeg: number,
  maxVehicles = SI_DIRECT_MAX_VEHICLES,
): SiPlacementResult {
  const angle = normalizedAngle(angleDeg);
  if (!SI_POSITION_ANGLES.includes(angle)) return { ok: false, reason: "invalid-angle" };
  if (!vehicleType.siRoles.includes(ring)) return { ok: false, reason: "ring-not-allowed" };
  if (positions.some((position) => position.ring === ring && normalizedAngle(position.angleDeg) === angle)) {
    return { ok: false, reason: "slot-occupied" };
  }
  if (positions.length >= maxVehicles) return { ok: false, reason: "max-vehicles" };
  return { ok: true, positions: [...positions, { typeId: vehicleType.id, ring, angleDeg: angle }] };
}

export function removeSiVehicle(positions: readonly SiPosition[], index: number) {
  return positions.filter((_, itemIndex) => itemIndex !== index);
}

export function deriveSiPairRules(positions: readonly SiPosition[]): SiPairRule[] {
  return positions.flatMap((first, firstIndex) => positions.slice(firstIndex + 1).map((second, offset) => ({
    first: firstIndex,
    second: firstIndex + offset + 1,
    angle: normalizedAngle(second.angleDeg - first.angleDeg),
  })));
}

export function describeSiMix(positions: readonly SiPosition[], vehicleTypes: readonly Pick<VehicleType, "id" | "name">[]) {
  const counts = new Map<string, number>();
  for (const position of positions) counts.set(position.typeId, (counts.get(position.typeId) ?? 0) + 1);
  return vehicleTypes
    .map((type) => ({ type, count: counts.get(type.id) ?? 0 }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.type.name}×${item.count}`)
    .join(" · ") || "ללא רכבים";
}

export function validateSiPositions(positions: readonly SiPosition[], vehicleTypes: readonly VehicleType[]) {
  if (positions.length < 2 || positions.length > SI_DIRECT_MAX_VEHICLES) return "SI דורש 2–5 רכבים";
  const byId = new Map(vehicleTypes.map((type) => [type.id, type]));
  const occupied = new Set<string>();
  for (const position of positions) {
    const type = byId.get(position.typeId);
    if (!type) return `סוג רכב לא קיים: ${position.typeId}`;
    if (!type.siRoles.includes(position.ring)) return `${type.name} אינו מורשה בטבעת ${position.ring}`;
    const angle = normalizedAngle(position.angleDeg);
    if (!SI_POSITION_ANGLES.includes(angle)) return `זווית SI חייבת להיות בכפולות של 30°: ${position.angleDeg}`;
    const key = `${position.ring}:${angle}`;
    if (occupied.has(key)) return "שני רכבים אינם יכולים להיות באותו מיקום על אותה טבעת";
    occupied.add(key);
  }
  return null;
}
