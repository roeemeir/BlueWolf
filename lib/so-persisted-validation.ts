import { relationCode, type SoRouteKind } from "./bluewolf";
import { deriveSoRelations, validateSoPlacements, type SoDirectPlacement } from "./so-direct-placement";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyTypeCounts(value: unknown): boolean {
  return record(value) && Object.keys(value).length === 0;
}

/**
 * Only schema-versioned, direct-placement SO templates are checked here.
 * Historical SO templates without the direct placement contract remain readable,
 * but an incomplete or internally inconsistent new template must not become
 * persisted truth in SQLite/D1 or be silently rendered with missing vehicles.
 *
 * SO direct v2 describes anonymous physical positions: vehicle types and vehicle
 * identifiers must be bound separately at runtime, not smuggled into template
 * slots or the v1 per-type counters. Rejecting hidden fields here prevents a
 * later consumer from assigning different semantics to the same saved template.
 */
export function validatePersistedSoTemplate(template: Record<string, unknown>): void {
  if (template.family !== "SO" || template.soSpec === undefined) return;
  const spec = template.soSpec;
  const id = String(template.id ?? "SO template");
  if (!record(spec)) throw new Error(`${id}.soSpec must be an object`);
  const direct = spec.schemaVersion !== undefined || spec.directPlacements !== undefined;
  if (!direct) return; // Legacy relation-only SO is not converted into invented positions.
  if (spec.schemaVersion !== "so-direct.v2") throw new Error(`${id}.soSpec schemaVersion must be so-direct.v2`);
  if (!Array.isArray(spec.chain) || spec.chain.length < 1 || spec.chain.length > 8 ||
      spec.chain.some((kind) => kind !== "single" && kind !== "double")) {
    throw new Error(`${id}.soSpec.chain must contain 1–8 valid single/double routes`);
  }
  if (!Array.isArray(spec.directPlacements) || spec.directPlacements.length < 1) {
    throw new Error(`${id}.soSpec.directPlacements must contain at least one position`);
  }
  // The v2 editor deliberately persists empty legacy counters. They cannot
  // secretly override the anonymous positions or introduce type-dependent SO.
  if ((spec.singleCounts !== undefined && !emptyTypeCounts(spec.singleCounts)) ||
      (spec.doubleCounts !== undefined && !emptyTypeCounts(spec.doubleCounts))) {
    throw new Error(`${id}.soSpec v2 type counters must be empty`);
  }
  const chain = spec.chain as SoRouteKind[];
  const placements = spec.directPlacements.map((value, index) => {
    const label = `${id}.soSpec.directPlacements[${index}]`;
    if (!record(value)) throw new Error(`${label} must be an object`);
    if (Object.keys(value).some((key) => key !== "routeIndex" && key !== "phase" && key !== "direction")) {
      throw new Error(`${label} must contain only anonymous routeIndex, phase and direction; vehicle binding belongs to the operational Core`);
    }
    if (!Number.isInteger(value.routeIndex) || (value.routeIndex as number) < 0 || (value.routeIndex as number) >= chain.length) {
      throw new Error(`${label}.routeIndex must reference an existing route`);
    }
    if (typeof value.phase !== "number" || !Number.isFinite(value.phase) ||
        !(chain[value.routeIndex as number] === "single" ? [0, 0.5] : [0, 0.25, 0.5, 0.75]).includes(value.phase)) {
      throw new Error(`${label}.phase must be an allowed half/quarter position`);
    }
    if (value.direction !== "forward" && value.direction !== "reverse") {
      throw new Error(`${label}.direction must be forward or reverse`);
    }
    return { routeIndex: value.routeIndex as number, phase: value.phase, direction: value.direction } satisfies SoDirectPlacement;
  });
  const placementError = validateSoPlacements(chain, placements);
  if (placementError) throw new Error(`${id}: ${placementError}`);
  const relations = deriveSoRelations(chain, placements);
  if (!Array.isArray(spec.relations) || spec.relations.length !== relations.length ||
      !spec.relations.every((value, index) => value === relations[index])) {
    throw new Error(`${id}.soSpec.relations do not match observed direct placements`);
  }
  if (!Array.isArray(template.values) || template.values.length !== relations.length ||
      !template.values.every((value, index) => value === relationCode(relations[index]))) {
    throw new Error(`${id}.values do not match observed direct placements`);
  }
  if (spec.generatorCounts !== undefined) {
    const counts = spec.generatorCounts;
    if (!record(counts) || !Number.isInteger(counts.single) || !Number.isInteger(counts.double) ||
        counts.single !== chain.filter((kind) => kind === "single").length ||
        counts.double !== chain.filter((kind) => kind === "double").length) {
      throw new Error(`${id}.soSpec.generatorCounts do not match the route chain`);
    }
  }
}
