import type { SyncTemplate, VehicleType } from "./bluewolf";
import { validateSiPositions } from "./si-direct-placement";

export type OperationalSiTemplateSlot = {
  id: string;
  vehicleType: string;
  routeRole: "inner" | "middle" | "outer";
  phaseOffset: number;
};

export type OperationalSiTemplate = {
  id: string;
  name: string;
  default: boolean;
  slots: OperationalSiTemplateSlot[];
};

type JsonObject = Record<string, unknown>;

const RING_ORDER = { inner: 0, middle: 1, outer: 2 } as const;

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}

function normalizedAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function slotId(ring: "inner" | "middle" | "outer", angleDeg: number, vehicleType: string, index: number) {
  return `si-${ring}-${angleDeg}-${vehicleType}-${index + 1}`;
}

/**
 * Convert only coordinate-authored SI templates into the operational Core contract.
 * Legacy SI templates that only contain pairwise display values are deliberately
 * excluded: reconstructing coordinates from them would silently invent runtime truth.
 */
export function operationalSiTemplates(
  templates: readonly SyncTemplate[],
  vehicleTypes: readonly VehicleType[],
): OperationalSiTemplate[] {
  const seenIds = new Set<string>();
  for (const template of templates) {
    if (!template.id.trim()) throw new Error("template id must be non-empty");
    if (seenIds.has(template.id)) throw new Error(`duplicate template id: ${template.id}`);
    seenIds.add(template.id);
  }

  return templates
    .filter((template) => template.family === "SI" && template.siPositions !== undefined)
    .map((template) => {
      const positions = template.siPositions ?? [];
      const validation = validateSiPositions(positions, [...vehicleTypes]);
      if (validation) throw new Error(`${template.id}: ${validation}`);
      const ordered = [...positions].sort((first, second) => {
        const ringDelta = RING_ORDER[first.ring] - RING_ORDER[second.ring];
        if (ringDelta) return ringDelta;
        const angleDelta = normalizedAngle(first.angleDeg) - normalizedAngle(second.angleDeg);
        if (angleDelta) return angleDelta;
        return first.typeId.localeCompare(second.typeId);
      });
      return {
        id: template.id,
        name: template.name.trim() || template.id,
        default: template.isDefault,
        slots: ordered.map((position, index) => {
          const angleDeg = normalizedAngle(position.angleDeg);
          return {
            id: slotId(position.ring, angleDeg, position.typeId, index),
            vehicleType: position.typeId,
            routeRole: position.ring,
            phaseOffset: angleDeg / 360,
          };
        }),
      } satisfies OperationalSiTemplate;
    })
    .sort((first, second) => first.id.localeCompare(second.id));
}

export function buildOperationalSiTemplateConfig(
  existingConfig: unknown,
  templates: readonly SyncTemplate[],
  vehicleTypes: readonly VehicleType[],
) {
  const root = structuredClone(object(existingConfig, "operational config"));
  root.siTemplates = operationalSiTemplates(templates, vehicleTypes);
  return root;
}
