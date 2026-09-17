import type { RingRole, SyncTemplate, VehicleType } from "./bluewolf";

type JsonObject = Record<string, unknown>;

export type OperationalSISlot = {
  id: string;
  vehicleType: string;
  routeRole: RingRole;
  phaseOffset: number;
  phaseSign: 1;
};

export type OperationalSITemplate = {
  id: string;
  name: string;
  default: boolean;
  slots: OperationalSISlot[];
};

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}

function normalizedAngle(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  const normalized = ((value % 360) + 360) % 360;
  const snapped = Math.round(normalized / 30) * 30 % 360;
  if (Math.abs(normalized - snapped) > 1e-9) throw new Error(`${label} must be a multiple of 30 degrees`);
  return snapped;
}

function validatePosition(
  template: SyncTemplate,
  typeById: Map<string, VehicleType>,
  position: NonNullable<SyncTemplate["siPositions"]>[number],
  index: number,
) {
  const vehicleType = typeById.get(position.typeId);
  if (!vehicleType) throw new Error(`SI template ${template.id} references unknown vehicle type ${position.typeId}`);
  if (!vehicleType.siRoles.includes(position.ring)) {
    throw new Error(`SI template ${template.id} places ${position.typeId} on forbidden ring ${position.ring}`);
  }
  return {
    id: `slot-${index + 1}`,
    vehicleType: position.typeId,
    routeRole: position.ring,
    phaseOffset: normalizedAngle(position.angleDeg, `SI template ${template.id} position ${index + 1}`) / 360,
    phaseSign: 1 as const,
  } satisfies OperationalSISlot;
}

export function operationalSiTemplates(templates: readonly SyncTemplate[], vehicleTypes: readonly VehicleType[]) {
  const typeById = new Map(vehicleTypes.map((type) => [type.id, type]));
  const ids = new Set<string>();
  const output: OperationalSITemplate[] = [];

  for (const template of templates) {
    if (template.family !== "SI") continue;
    // Legacy pair-only templates stay readable in the workspace but are not
    // promoted to operational truth. New SI authoring owns siPositions.
    if (!Array.isArray(template.siPositions) || template.siPositions.length === 0) continue;
    if (!template.id.trim()) throw new Error("SI template id must be non-empty");
    if (ids.has(template.id)) throw new Error(`duplicate SI template id: ${template.id}`);
    ids.add(template.id);
    if (template.siPositions.length < 2) throw new Error(`SI template ${template.id} requires at least two positions`);

    const occupied = new Set<string>();
    const slots = template.siPositions.map((position, index) => {
      const angle = normalizedAngle(position.angleDeg, `SI template ${template.id} position ${index + 1}`);
      const key = `${position.ring}:${angle}`;
      if (occupied.has(key)) throw new Error(`SI template ${template.id} contains duplicate placement ${key}`);
      occupied.add(key);
      return validatePosition(template, typeById, { ...position, angleDeg: angle }, index);
    });

    output.push({
      id: template.id,
      name: template.name.trim() || template.id,
      default: template.isDefault === true,
      slots,
    });
  }
  return output;
}

export function buildOperationalSiConfig(
  existingConfig: unknown,
  templates: readonly SyncTemplate[],
  vehicleTypes: readonly VehicleType[],
) {
  const root = structuredClone(object(existingConfig, "operational config"));
  root.siTemplates = operationalSiTemplates(templates, vehicleTypes);
  return root;
}
