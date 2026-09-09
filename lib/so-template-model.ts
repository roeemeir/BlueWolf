import type { SyncTemplate, VehicleType } from "./bluewolf";

export type SoQuarter = "Q0" | "Q1" | "Q2" | "Q3";
export type SoNormalizedRouteKind = "single" | "double" | "figure8";
export type SoDerivedRelation = "same" | "opposite" | "mixed";

export type SoVehicleSlot = {
  id: string;
  vehicleTypeId: string | null;
  quarter: SoQuarter;
};

export type SoRouteInstance = {
  id: string;
  kind: SoNormalizedRouteKind;
  geometryProfileRef?: string;
  slots: SoVehicleSlot[];
};

export type SoNormalizedTemplateSpec = {
  schemaVersion: "bluewolf.so-template.v1";
  routeInstances: SoRouteInstance[];
};

export type SyncTemplateWithNormalizedSo = SyncTemplate & {
  soV11?: SoNormalizedTemplateSpec;
};

const QUARTERS: SoQuarter[] = ["Q0", "Q1", "Q2", "Q3"];

export function soCapacity(kind: SoNormalizedRouteKind) {
  return kind === "double" ? 4 : 2;
}

export function quarterIndex(quarter: SoQuarter) {
  return QUARTERS.indexOf(quarter);
}

export function quarterRelation(first: SoQuarter, second: SoQuarter): SoDerivedRelation {
  const delta = (quarterIndex(second) - quarterIndex(first) + 4) % 4;
  if (delta === 0) return "same";
  if (delta === 2) return "opposite";
  return "mixed";
}

export function relationCode(relation: SoDerivedRelation) {
  return relation === "same" ? 0 : relation === "mixed" ? 1 : 2;
}

export function routeRelation(first: SoRouteInstance, second: SoRouteInstance): SoDerivedRelation {
  const firstOccupied = first.slots.find((slot) => slot.vehicleTypeId);
  const secondOccupied = second.slots.find((slot) => slot.vehicleTypeId);
  if (!firstOccupied || !secondOccupied) return "mixed";
  return quarterRelation(firstOccupied.quarter, secondOccupied.quarter);
}

export function validateSoSpec(spec: SoNormalizedTemplateSpec) {
  if (spec.schemaVersion !== "bluewolf.so-template.v1") throw new Error("unsupported SO template schema");
  if (spec.routeInstances.length === 0) throw new Error("SO template requires at least one Route Instance");
  const routeIds = new Set<string>();
  for (const route of spec.routeInstances) {
    if (routeIds.has(route.id)) throw new Error(`duplicate Route Instance id: ${route.id}`);
    routeIds.add(route.id);
    if (route.kind !== "single" && route.kind !== "double" && route.kind !== "figure8") throw new Error(`unsupported SO Route kind: ${route.kind}`);
    const capacity = soCapacity(route.kind);
    if (route.slots.length !== capacity) throw new Error(`${route.kind} must expose exactly ${capacity} slots`);
    const slotIds = new Set<string>();
    for (const slot of route.slots) {
      if (slotIds.has(slot.id)) throw new Error(`duplicate slot id: ${slot.id}`);
      slotIds.add(slot.id);
      if (!QUARTERS.includes(slot.quarter)) throw new Error(`invalid SO quarter: ${slot.quarter}`);
    }
    const occupiedQuarterKeys = route.slots.filter((slot) => slot.vehicleTypeId).map((slot) => slot.quarter);
    if (new Set(occupiedQuarterKeys).size !== occupiedQuarterKeys.length) {
      throw new Error(`${route.id} cannot place two occupied slots on the same quarter`);
    }
  }
  return spec;
}

export function emptyRouteInstance(kind: SoNormalizedRouteKind, id = `so-route-${crypto.randomUUID()}`): SoRouteInstance {
  const capacity = soCapacity(kind);
  return {
    id,
    kind,
    slots: Array.from({ length: capacity }, (_, index) => ({
      id: `${id}-slot-${index + 1}`,
      vehicleTypeId: null,
      quarter: QUARTERS[index] ?? "Q0",
    })),
  };
}

function expandLegacyCounts(counts: Record<string, number> | undefined) {
  if (!counts) return [];
  return Object.entries(counts).flatMap(([vehicleTypeId, count]) => Array.from({ length: Math.max(0, Math.floor(count)) }, () => vehicleTypeId));
}

function legacyRelationToQuarter(relation: string | undefined): SoQuarter {
  if (relation === "same") return "Q0";
  if (relation === "opposite") return "Q2";
  return "Q1";
}

export function normalizedSoSpec(template: SyncTemplate): SoNormalizedTemplateSpec | null {
  const enriched = template as SyncTemplateWithNormalizedSo;
  if (enriched.soV11) return validateSoSpec(structuredClone(enriched.soV11));
  const legacy = template.soSpec;
  if (!legacy) return null;

  const singleVehicleTypes = expandLegacyCounts(legacy.singleCounts);
  const doubleVehicleTypes = expandLegacyCounts(legacy.doubleCounts);
  const routeInstances = legacy.chain.map((kind, index) => {
    const normalizedKind: SoNormalizedRouteKind = kind === "double" ? "double" : "single";
    const route = emptyRouteInstance(normalizedKind, `legacy-${template.id}-${index + 1}`);
    const source = normalizedKind === "double" ? doubleVehicleTypes : singleVehicleTypes;
    const anchorQuarter = index === 0 ? "Q0" : legacyRelationToQuarter(legacy.relations[index - 1]);
    return {
      ...route,
      slots: route.slots.map((slot, slotIndex) => ({
        ...slot,
        vehicleTypeId: source[slotIndex] ?? null,
        quarter: slotIndex === 0 ? anchorQuarter : QUARTERS[(quarterIndex(anchorQuarter) + slotIndex) % 4],
      })),
    };
  });
  return validateSoSpec({ schemaVersion: "bluewolf.so-template.v1", routeInstances });
}

export function compatibilitySoFields(spec: SoNormalizedTemplateSpec) {
  validateSoSpec(spec);
  const chain = spec.routeInstances.map((route) => route.kind === "double" ? "double" as const : "single" as const);
  const relations = spec.routeInstances.slice(0, -1).map((route, index) => routeRelation(route, spec.routeInstances[index + 1]));
  const values = relations.map(relationCode);
  const countsFor = (kind: "single" | "double") => {
    const result: Record<string, number> = {};
    for (const route of spec.routeInstances.filter((item) => kind === "double" ? item.kind === "double" : item.kind !== "double")) {
      for (const slot of route.slots) if (slot.vehicleTypeId) result[slot.vehicleTypeId] = (result[slot.vehicleTypeId] ?? 0) + 1;
    }
    return result;
  };
  return {
    values,
    soSpec: {
      singleCounts: countsFor("single"),
      doubleCounts: countsFor("double"),
      chain,
      // Compatibility only: derived from quarters. It is never an editable source of truth.
      relations,
    },
  };
}

export function soTemplateSummary(spec: SoNormalizedTemplateSpec, vehicleTypes: VehicleType[]) {
  const names = new Map(vehicleTypes.map((type) => [type.id, type.name]));
  const occupied = spec.routeInstances.flatMap((route) => route.slots.filter((slot) => slot.vehicleTypeId));
  const byType = new Map<string, number>();
  for (const slot of occupied) byType.set(slot.vehicleTypeId!, (byType.get(slot.vehicleTypeId!) ?? 0) + 1);
  return [...byType.entries()].map(([id, count]) => `${names.get(id) ?? id}×${count}`).join(" · ") || "ללא רכבים";
}

export function soConstellationLabel(spec: SoNormalizedTemplateSpec) {
  return spec.routeInstances.map((route) => route.kind === "double" ? "כפול" : route.kind === "figure8" ? "שמינייה" : "יחיד").join(" — ");
}

export const SO_QUARTERS = QUARTERS;
