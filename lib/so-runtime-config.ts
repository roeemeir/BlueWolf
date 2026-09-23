import type { SyncTemplate } from "./bluewolf";
import { validatePersistedSoTemplate } from "./so-persisted-validation";

type JsonObject = Record<string, unknown>;
type DirectPlacement = { routeIndex: number; phase: number; direction: "forward" | "reverse" };
type DirectSpec = { schemaVersion: "so-direct.v2"; chain: ("single" | "double")[]; directPlacements: DirectPlacement[] };
type ExplicitBinding = {
  templateId: string;
  routeInstanceIds: string[];
  slots: { placementIndex: number; slotId: string; vehicleType: string }[];
};

export type SoRuntimeBridgeResult = {
  config: JsonObject;
  appliedTemplateIds: string[];
  missingTemplateIds: string[];
};

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}
function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}
function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} must contain unique values`);
}

/**
 * A saved SO direct template deliberately contains NO vehicle types or IDs.
 * The operator/deployer must explicitly bind its anonymous physical positions
 * to Core route-instance IDs and vehicle TYPES in `soTemplateBindings`. Actual
 * vehicle IDs/work speeds remain separately assigned by `servers[].groups`.
 *
 * This bridge never guesses absent bindings or changes existing Core bank rows.
 * Until Python Core represents and checks slot direction, reverse positions are
 * rejected rather than silently scored using forward-only quarter semantics.
 */
export function bindSoDirectTemplatesToCore(existing: unknown, templates: readonly SyncTemplate[]): SoRuntimeBridgeResult {
  const root = structuredClone(object(existing, "operational config"));
  const authored = templates.filter((item) => item.family === "SO" && (item.soSpec as { schemaVersion?: unknown } | undefined)?.schemaVersion === "so-direct.v2");
  const rawBindings = root.soTemplateBindings;
  if (rawBindings === undefined) {
    return { config: root, appliedTemplateIds: [], missingTemplateIds: authored.map((item) => item.id) };
  }
  if (!Array.isArray(rawBindings)) throw new Error("soTemplateBindings must be an array");
  if (!Array.isArray(root.templates)) throw new Error("operational Core templates must be an array");
  if (!Array.isArray(root.servers)) throw new Error("operational Core servers must be an array");
  const bindings = new Map<string, ExplicitBinding>();
  for (const [index, value] of rawBindings.entries()) {
    const row = object(value, `soTemplateBindings[${index}]`);
    const templateId = nonempty(row.templateId, "SO binding templateId");
    if (bindings.has(templateId)) throw new Error(`duplicate SO binding for ${templateId}`);
    if (!Array.isArray(row.routeInstanceIds) || !Array.isArray(row.slots)) throw new Error(`${templateId}: explicit routes and slots are required`);
    const routeInstanceIds = row.routeInstanceIds.map((item: unknown) => nonempty(item, `${templateId} routeInstanceId`));
    unique(routeInstanceIds, `${templateId} routeInstanceIds`);
    const slots = row.slots.map((value: unknown) => {
      const slot = object(value, `${templateId} slot`);
      if (!Number.isInteger(slot.placementIndex) || (slot.placementIndex as number) < 0) throw new Error(`${templateId}: slot requires a non-negative placementIndex`);
      return {
        placementIndex: slot.placementIndex as number,
        slotId: nonempty(slot.slotId, `${templateId} slotId`),
        vehicleType: nonempty(slot.vehicleType, `${templateId} vehicleType`),
      };
    });
    unique(slots.map((item) => item.slotId), `${templateId} slot IDs`);
    bindings.set(templateId, { templateId, routeInstanceIds, slots });
  }
  const operational = [...root.templates];
  const appliedTemplateIds: string[] = [];
  const missingTemplateIds: string[] = [];
  for (const template of authored) {
    const binding = bindings.get(template.id);
    if (!binding) { missingTemplateIds.push(template.id); continue; }
    validatePersistedSoTemplate(template as unknown as JsonObject);
    const spec = template.soSpec as unknown as DirectSpec;
    if (binding.routeInstanceIds.length !== spec.chain.length) throw new Error(`${template.id}: route-instance count differs from saved SO chain`);
    if (binding.slots.length !== spec.directPlacements.length) throw new Error(`${template.id}: every physical placement needs exactly one explicit type binding`);
    const slotsByPosition = new Map(binding.slots.map((item) => [item.placementIndex, item]));
    if (slotsByPosition.size !== binding.slots.length || binding.slots.some((slot) => slot.placementIndex >= spec.directPlacements.length)) {
      throw new Error(`${template.id}: SO position indices must be unique and in range`);
    }
    if (spec.directPlacements.some((placement) => placement.direction !== "forward")) {
      throw new Error(`${template.id}: reverse SO direction is not yet enforced by operational Python Core; refusing a false forward-only binding`);
    }
    const routes = spec.chain.map((kind, routeIndex) => ({
      id: binding.routeInstanceIds[routeIndex],
      kind,
      slots: spec.directPlacements.flatMap((placement, placementIndex) => {
        if (placement.routeIndex !== routeIndex) return [];
        const slot = slotsByPosition.get(placementIndex);
        if (!slot) throw new Error(`${template.id}: unbound physical SO position ${placementIndex}`);
        return [{ id: slot.slotId, vehicleType: slot.vehicleType, quarter: `Q${Math.round(placement.phase * 4)}` }];
      }),
    }));
    if (routes.some((route) => route.slots.length === 0)) throw new Error(`${template.id}: every Core route instance needs an explicitly bound member`);
    const matchingGroup = root.servers.some((rawServer) => {
      const server = rawServer as { groups?: unknown };
      if (!Array.isArray(server?.groups)) return false;
      return server.groups.some((rawGroup) => {
        const group = rawGroup as { routeInstances?: unknown; members?: unknown };
        if (!Array.isArray(group?.routeInstances) || !Array.isArray(group.members)) return false;
        const instanceMap = new Map((group.routeInstances as { id?: string; kind?: string }[]).map((item) => [item.id, item.kind]));
        const memberTypes = group.members as { routeInstanceId?: string; vehicleType?: string; vehicleId?: unknown; workSpeedMps?: unknown }[];
        return routes.every((route) => instanceMap.get(route.id) === route.kind &&
          JSON.stringify(memberTypes.filter((member) => member.routeInstanceId === route.id).map((member) => member.vehicleType).sort()) ===
          JSON.stringify(route.slots.map((slot) => slot.vehicleType).sort()) &&
          memberTypes.filter((member) => member.routeInstanceId === route.id).every((member) =>
            Number.isInteger(member.vehicleId) && typeof member.workSpeedMps === "number" && member.workSpeedMps > 0));
      });
    });
    if (!matchingGroup) throw new Error(`${template.id}: no explicitly configured Core server group binds all route IDs, vehicle types/IDs and work speeds`);
    const next = { id: template.id, name: template.name, default: template.isDefault, routes };
    const existingIndex = operational.findIndex((row) => row !== null && typeof row === "object" && (row as { id?: unknown }).id === template.id);
    if (existingIndex >= 0) operational[existingIndex] = next;
    else operational.push(next);
    appliedTemplateIds.push(template.id);
  }
  root.templates = operational;
  return { config: root, appliedTemplateIds, missingTemplateIds };
}
