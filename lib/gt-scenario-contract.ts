import { normalizeCapturedRuntimeProvenance, type CapturedRuntimeProvenance } from "@/lib/runtime-provenance";

export type GtScenarioFamily = "SI" | "SO";

export type GtScenarioGroup = {
  id: string;
  name: string;
  family: GtScenarioFamily;
  routeId: string;
  templateId: string;
  participantIds: number[];
};

export type GtScenario = {
  id: string;
  name: string;
  serverId: string;
  arena: string;
  startAt: string;
  endAt: string;
  groups: GtScenarioGroup[];
  notes: string;
  revision: number;
  provenance?: CapturedRuntimeProvenance | null;
  createdAt?: string;
  updatedAt?: string;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function text(value: unknown, label: string, max = 160) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${label} is too long`);
  return result;
}

function iso(value: unknown, label: string) {
  const result = text(value, label, 80);
  const ms = Date.parse(result);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be ISO-8601`);
  return new Date(ms).toISOString();
}

function identifier(value: unknown, label: string) {
  const result = text(value, label, 120);
  if (!/^[A-Za-z0-9_.:@-]+$/.test(result)) throw new Error(`${label} contains unsupported characters`);
  return result;
}

function participantIds(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length < 1 || value.length > 100) throw new Error(`${label} must contain 1-100 vehicles`);
  const ids = value.map((item) => Number(item));
  if (ids.some((item) => !Number.isInteger(item) || item < 0 || item > 2_147_483_647)) throw new Error(`${label} contains an invalid vehicle identifier`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate vehicles`);
  return ids;
}

export function normalizeGtScenario(value: unknown): GtScenario {
  const row = object(value, "GT scenario");
  const id = identifier(row.id, "GT scenario id");
  const name = text(row.name, "GT scenario name");
  const serverId = identifier(row.serverId, "GT server id");
  const arena = text(row.arena, "GT arena");
  const startAt = iso(row.startAt, "GT startAt");
  const endAt = iso(row.endAt, "GT endAt");
  if (startAt >= endAt) throw new Error("GT scenario startAt must be before endAt");
  if (!Array.isArray(row.groups) || row.groups.length < 1 || row.groups.length > 64) throw new Error("GT scenario must contain 1-64 groups");
  const groupIds = new Set<string>();
  const vehicleOwners = new Map<number, string>();
  const groups = row.groups.map((raw, index): GtScenarioGroup => {
    const group = object(raw, `GT group ${index + 1}`);
    const groupId = identifier(group.id, `GT group ${index + 1} id`);
    if (groupIds.has(groupId)) throw new Error(`duplicate GT group id ${groupId}`);
    groupIds.add(groupId);
    const family = group.family;
    if (family !== "SI" && family !== "SO") throw new Error(`GT group ${groupId} family must be SI or SO`);
    const participants = participantIds(group.participantIds, `GT group ${groupId} participants`);
    for (const vehicleId of participants) {
      const owner = vehicleOwners.get(vehicleId);
      if (owner) throw new Error(`vehicle ${vehicleId} belongs to both GT groups ${owner} and ${groupId}`);
      vehicleOwners.set(vehicleId, groupId);
    }
    return {
      id: groupId,
      name: text(group.name, `GT group ${groupId} name`),
      family,
      routeId: identifier(group.routeId, `GT group ${groupId} routeId`),
      templateId: identifier(group.templateId, `GT group ${groupId} templateId`),
      participantIds: participants,
    };
  });
  const revisionRaw = Number(row.revision ?? 0);
  if (!Number.isInteger(revisionRaw) || revisionRaw < 0) throw new Error("GT scenario revision is invalid");
  const provenance = row.provenance === undefined || row.provenance === null
    ? null
    : normalizeCapturedRuntimeProvenance(row.provenance);
  return {
    id,
    name,
    serverId,
    arena,
    startAt,
    endAt,
    groups,
    notes: typeof row.notes === "string" ? row.notes.slice(0, 4_000) : "",
    revision: revisionRaw,
    provenance,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
  };
}

export function gtScenarioSummary(scenario: GtScenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    serverId: scenario.serverId,
    arena: scenario.arena,
    startAt: scenario.startAt,
    endAt: scenario.endAt,
    groupCount: scenario.groups.length,
    participantCount: scenario.groups.reduce((sum, group) => sum + group.participantIds.length, 0),
    revision: scenario.revision,
    codeSha: scenario.provenance?.codeSha ?? null,
    configVersion: scenario.provenance?.configVersion ?? null,
    provenanceSource: scenario.provenance?.source ?? null,
    createdAt: scenario.createdAt ?? null,
    updatedAt: scenario.updatedAt ?? null,
  };
}
