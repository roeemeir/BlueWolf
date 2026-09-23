import { DEFAULT_WORKSPACE, type SiPosition, type SyncTemplate, type VehicleType } from "./bluewolf";
import { deriveSiPairRules, validateSiPositions } from "./si-direct-placement";

/**
 * A SQLite/D1 or browser JSON round-trip may reorder object keys, including
 * nested siPairs. Compare the entire historical record structurally instead of
 * relying on insertion order. Arrays (including vehicle slots) remain ordered,
 * and extra/missing fields or any user-edited value must still prevent migration.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Only upgrade the two historical, unedited built-in SI records. In particular,
 * the old [90,90,90] complete pair law has no physical three-vehicle solution.
 * User-authored templates (even ones reusing a built-in ID) must never be
 * rewritten. The positions are the source of truth for both the Core and UI.
 */
export function migrateUntouchedBuiltInSiTemplates(
  templates: readonly SyncTemplate[],
  vehicleTypes: readonly VehicleType[],
): SyncTemplate[] {
  const original = DEFAULT_WORKSPACE.templates.filter((template) => template.family === "SI");
  const placements: Record<string, SiPosition[]> = {
    "tpl-si-90": [
      { typeId: "storm", ring: "inner", angleDeg: 0 },
      { typeId: "lightning", ring: "middle", angleDeg: 90 },
      { typeId: "thunder", ring: "outer", angleDeg: 180 },
    ],
    "tpl-si-120": [
      { typeId: "storm", ring: "inner", angleDeg: 0 },
      { typeId: "lightning", ring: "middle", angleDeg: 120 },
      { typeId: "thunder", ring: "outer", angleDeg: 240 },
    ],
  };
  return templates.map((template) => {
    const legacy = original.find((item) => item.id === template.id);
    const positions = placements[template.id];
    if (!legacy || !positions || template.siPositions !== undefined) return template;
    // Compare every historical field (including timestamp, pair rules and
    // default flag); key reordering alone does not indicate a user edit.
    if (canonicalJson(template) !== canonicalJson(legacy)) return template;
    if (validateSiPositions(positions, [...vehicleTypes])) return template;
    const siPairs = deriveSiPairRules(positions);
    return {
      ...template,
      name: template.id === "tpl-si-90" ? "SI · רכבים עוקבים · 90°" : template.name,
      law: template.id === "tpl-si-90" ? "90° בין רכבים עוקבים, ללא תלות בטבעת" : template.law,
      values: siPairs.map((pair) => pair.angle),
      siPairs,
      siPositions: positions.map((slot) => ({ ...slot })),
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
  });
}
