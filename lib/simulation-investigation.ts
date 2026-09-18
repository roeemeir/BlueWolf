import {
  EVENT_RECOMPUTE_SCHEMA,
  INVESTIGATION_EVENTS_SCHEMA,
  type EventRecomputeResult,
  type InvestigationEventIndex,
  type InvestigationEventList,
} from "./investigation-contract";
import { DEFAULT_WORKSPACE, getServerScenario, type Family, type SyncTemplate } from "./bluewolf";
import { buildSoSmileGeometry } from "./so-geometry";
import type { InvestigationPdfEvent, InvestigationPdfReport } from "./investigation-pdf";

export const SIMULATION_ARCHIVE_DAYS = 7;
export const SIMULATION_ARCHIVE_SOURCE = "simulator-archive" as const;
export const SIMULATION_CODE_VERSION = "bluewolf-simulator-7d-v2";
export const SIMULATION_CONFIG_VERSION = "three-server-rich-scenarios-v2";

const DAY_MS = 86_400_000;
const FRAME_COUNT = 24;
const SCHEDULE = [
  { hour: 5, minute: 20, durationMinutes: 22 },
  { hour: 9, minute: 5, durationMinutes: 31 },
  { hour: 13, minute: 40, durationMinutes: 26 },
  { hour: 18, minute: 10, durationMinutes: 38 },
] as const;

type SimulationEvent = InvestigationEventIndex & { seed: number; scenarioKind: string };

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function serverNumber(serverId: string | number) {
  const value = Number(serverId);
  if (!Number.isInteger(value) || value < 1 || value > 3) throw new Error("simulation serverId must be 1, 2 or 3");
  return value;
}
function startOfUtcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}
function eventLifecycle(startAt: string, endAt: string, groupId: string, serverId: number, active = false) {
  return {
    status: active ? "active" as const : "closed" as const,
    openedAt: startAt,
    openingReason: "simulated_stable_group",
    endedAt: active ? null : endAt,
    endingReason: active ? null : "simulated_scenario_complete",
    finalizeAt: active ? null : endAt,
    closedAt: active ? null : endAt,
    changes: [
      { occurredAt: startAt, kind: "opened", serverId, groupId, details: { source: "simulation", deterministic: true } },
      ...(active ? [] : [{ occurredAt: endAt, kind: "closed", serverId, groupId, details: { source: "simulation", deterministic: true } }]),
    ],
  };
}
function defaultTemplate(family: Family) {
  return DEFAULT_WORKSPACE.templates.find((template) => template.family === family && template.isDefault)
    ?? DEFAULT_WORKSPACE.templates.find((template) => template.family === family)!;
}
function templateList() {
  return DEFAULT_WORKSPACE.templates.map((template) => ({ id: template.id, name: template.name, family: template.family }));
}

export function simulationActiveEventId(serverId: string | number, family: Family) {
  return `sim-s${serverNumber(serverId)}-${family.toLowerCase()}-active`;
}

export function simulationEvents(serverIdValue: string | number, now = new Date()): SimulationEvent[] {
  const serverId = serverNumber(serverIdValue);
  const scenario = getServerScenario(String(serverId));
  const events: SimulationEvent[] = [];
  const today = startOfUtcDay(now);
  for (let dayOffset = SIMULATION_ARCHIVE_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    const dayStart = today - dayOffset * DAY_MS;
    SCHEDULE.forEach((slot, slotIndex) => {
      const family: Family = (dayOffset + slotIndex + serverId) % 2 === 0 ? "SI" : "SO";
      const group = family === "SI" ? scenario.groups.si : scenario.groups.so;
      const startMs = dayStart + (slot.hour * 60 + slot.minute) * 60_000;
      const endMs = startMs + slot.durationMinutes * 60_000;
      const eventId = `sim-s${serverId}-d${dayOffset}-e${slotIndex}-${family.toLowerCase()}`;
      const seed = hash(eventId);
      events.push({
        eventId,
        serverId,
        groupId: group.id,
        family,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        frameCount: FRAME_COUNT,
        activeTemplateId: defaultTemplate(family).id,
        lifecycle: eventLifecycle(new Date(startMs).toISOString(), new Date(endMs).toISOString(), group.id, serverId),
        seed,
        scenarioKind: ["nominal", "gps-noise", "turn-dropout", "formation-change", "late-data", "route-drift"][seed % 6],
      });
    });
  }
  for (const family of ["SI", "SO"] as const) {
    const group = family === "SI" ? scenario.groups.si : scenario.groups.so;
    const endMs = now.getTime();
    const startMs = endMs - (family === "SI" ? 33 : 41) * 60_000;
    const eventId = simulationActiveEventId(serverId, family);
    events.push({
      eventId,
      serverId,
      groupId: group.id,
      family,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      frameCount: FRAME_COUNT,
      activeTemplateId: group.templateId,
      lifecycle: eventLifecycle(new Date(startMs).toISOString(), new Date(endMs).toISOString(), group.id, serverId, true),
      seed: hash(eventId),
      scenarioKind: family === "SO" ? "active-turn-timing" : "active-angle-drift",
    });
  }
  return events.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function listSimulationInvestigationEvents(
  serverIdValue: string | number,
  from?: string | null,
  to?: string | null,
  now = new Date(),
): InvestigationEventList {
  const serverId = serverNumber(serverIdValue);
  const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) throw new Error("simulation investigation range is invalid");
  const events = simulationEvents(serverId, now)
    .filter((event) => Date.parse(event.endAt) >= fromMs && Date.parse(event.startAt) <= toMs)
    .map(({ seed: _seed, scenarioKind: _scenarioKind, ...event }) => event);
  return { schemaVersion: INVESTIGATION_EVENTS_SCHEMA, serverId, templates: templateList(), events };
}

function routeCenter(serverId: number) {
  return {
    latitude: 32.065 + serverId * 0.012,
    longitude: 34.755 + serverId * 0.014,
  };
}
function localToWgs84(center: { latitude: number; longitude: number }, x: number, y: number) {
  return { latitude: center.latitude + y / 111_320, longitude: center.longitude + x / (111_320 * Math.cos(center.latitude * Math.PI / 180)) };
}
function circleCenterline(center: { latitude: number; longitude: number }, radiusM = 150) {
  return Array.from({ length: 40 }, (_, index) => {
    const angle = index / 39 * Math.PI * 2;
    return localToWgs84(center, Math.cos(angle) * radiusM, Math.sin(angle) * radiusM);
  });
}
function soRoutes(serverId: number) {
  const center = routeCenter(serverId);
  const routes = buildSoSmileGeometry(["single", "double", "single"], {
    centerX: 0, centerY: 0, spacing: 260, risePerStep: 32, radius: 48, singleHalfLeg: 110, doubleHalfLeg: 205, samplesPerTurn: 16,
  });
  return routes.map((route, index) => ({
    routeInstanceId: `so-r${index + 1}`,
    routeId: `sim-so-${serverId}-${index + 1}`,
    family: "SO",
    subtype: route.kind === "double" ? "double_hippodrome" : "hippodrome",
    topology: route.kind === "double" ? "double" : "single",
    centerLatitude: localToWgs84(center, route.center.x, route.center.y).latitude,
    centerLongitude: localToWgs84(center, route.center.x, route.center.y).longitude,
    lengthM: route.kind === "double" ? 1_120 : 650,
    longAxisAM: route.kind === "double" ? 220 : 125,
    shortAxisBM: 48,
    orientationDeg: route.rotationDeg,
    estimatedPeriodS: route.kind === "double" ? 300 : 150,
    direction: "clockwise",
    detectionQuality: 0.9,
    centerline: route.points.map((point) => localToWgs84(center, point.x, point.y)),
  }));
}
function siRoutes(serverId: number) {
  const center = routeCenter(serverId);
  const centerline = circleCenterline(center);
  return [{
    routeInstanceId: "si-r1", routeId: `sim-si-${serverId}`, family: "SI", subtype: "compact_closed", topology: "closed",
    centerLatitude: center.latitude, centerLongitude: center.longitude, lengthM: 2 * Math.PI * 150, longAxisAM: 150, shortAxisBM: 150,
    orientationDeg: 0, estimatedPeriodS: 180, direction: "clockwise", detectionQuality: 0.94, centerline,
  }];
}
function interpolateLine(points: { latitude: number; longitude: number }[], phase: number) {
  const normalized = ((phase % 1) + 1) % 1;
  const index = Math.min(points.length - 2, Math.floor(normalized * (points.length - 1)));
  const local = normalized * (points.length - 1) - index;
  const first = points[index], second = points[index + 1];
  return {
    latitude: first.latitude + (second.latitude - first.latitude) * local,
    longitude: first.longitude + (second.longitude - first.longitude) * local,
  };
}
function chosenTemplate(templateId: string, family: Family, explicit?: Partial<SyncTemplate> | null): Partial<SyncTemplate> & Pick<SyncTemplate, "id" | "family"> {
  if (explicit?.id === templateId && explicit.family === family) return explicit;
  return DEFAULT_WORKSPACE.templates.find((template) => template.id === templateId && template.family === family)
    ?? { id: templateId, family, values: [], soSpec: undefined, siPositions: undefined };
}

export function recomputeSimulationEvent(input: {
  serverId: string | number;
  eventId: string;
  templateId: string;
  scenarioId?: string;
  groupId?: string;
  family?: Family;
  template?: Partial<SyncTemplate> | null;
  now?: Date;
}): EventRecomputeResult {
  const serverId = serverNumber(input.serverId);
  const now = input.now ?? new Date();
  const event = simulationEvents(serverId, now).find((candidate) => candidate.eventId === input.eventId);
  const family = event?.family ?? input.family;
  if (!family) throw new Error("simulation event family is required");
  const scenario = getServerScenario(String(serverId));
  const group = family === "SI" ? scenario.groups.si : scenario.groups.so;
  const groupId = event?.groupId ?? input.groupId ?? group.id;
  const startAt = event?.startAt ?? new Date(now.getTime() - 30 * 60_000).toISOString();
  const endAt = event?.endAt ?? now.toISOString();
  const lifecycle = event?.lifecycle ?? eventLifecycle(startAt, endAt, groupId, serverId, true);
  const seed = event?.seed ?? hash(input.eventId);
  const template = chosenTemplate(input.templateId, family, input.template);
  const templateSignature = JSON.stringify([template.id, template.values ?? [], template.soSpec?.chain ?? [], template.siPositions ?? []]);
  const templatePenalty = hash(templateSignature) % 15;
  const routes = family === "SI" ? siRoutes(serverId) : soRoutes(serverId);
  const memberRows = group.members.slice(0, family === "SI" ? 3 : 4);
  const startMs = Date.parse(startAt), endMs = Date.parse(endAt);
  const scenarioPenalty = [0, 6, 11, 14, 8, 10][seed % 6];
  const points = Array.from({ length: FRAME_COUNT }, (_, frameIndex) => {
    const observedAt = new Date(startMs + (endMs - startMs) * frameIndex / Math.max(1, FRAME_COUNT - 1)).toISOString();
    const missing = (seed % 3 === 1 && (frameIndex === 7 || frameIndex === 8)) || (seed % 5 === 0 && frameIndex === 15);
    if (missing) return { observedAt, pendingReason: "simulated_observability_gap", group: { valid: false, sync: null, route: null, total: null }, members: [], navigation: [] };
    const phase = frameIndex / Math.max(1, FRAME_COUNT - 1);
    const sync = clamp(91 - scenarioPenalty - templatePenalty * 0.7 + Math.sin(phase * Math.PI * 4 + serverId) * 8);
    const routeScore = clamp(93 - scenarioPenalty * 0.45 + Math.cos(phase * Math.PI * 3 + seed % 4) * 5);
    const total = clamp(sync * 0.75 + routeScore * 0.25);
    const members = memberRows.map((vehicle, memberIndex) => {
      const memberSync = clamp(sync + (memberIndex - 1.5) * 2.6);
      const memberRoute = clamp(routeScore - memberIndex * 1.3);
      return {
        memberId: String(vehicle.id), routeInstanceId: family === "SI" ? "si-r1" : `so-r${Math.min(3, memberIndex + 1)}`,
        slotId: `${family.toLowerCase()}-slot-${memberIndex + 1}`, expectedPhase: ((phase + memberIndex / memberRows.length) % 1),
        positionErrorCycle: Math.abs(100 - memberSync) / 300, valid: true, sync: memberSync, route: memberRoute,
        total: clamp(memberSync * 0.75 + memberRoute * 0.25),
        primaryReason: memberSync < memberRoute ? (family === "SI" ? "si_relative_angle" : "so_template_phase") : "route_adherence",
      };
    });
    const navigation = memberRows.map((vehicle, memberIndex) => {
      const route = family === "SI" ? routes[0] : routes[Math.min(routes.length - 1, memberIndex % routes.length)];
      const p = interpolateLine(route.centerline, phase + memberIndex / memberRows.length);
      const wobble = (memberIndex - 1.5) * 0.000006;
      return {
        memberId: String(vehicle.id), vehicleIdentifier: vehicle.id, latitude: p.latitude + wobble, longitude: p.longitude - wobble,
        altitudeM: 45 + memberIndex * 3, velocityNorthMps: 9 + Math.sin(phase * Math.PI * 2), velocityEastMps: 11 + Math.cos(phase * Math.PI * 2),
        headingDeg: ((phase * 360) + memberIndex * 18) % 360, active: true, reliability: 0.96 - memberIndex * 0.01,
      };
    });
    return { observedAt, pendingReason: null, group: { valid: true, sync, route: routeScore, total }, members, navigation };
  });
  const scored = points.filter((point) => point.pendingReason === null);
  const average = (key: "sync" | "route" | "total") => scored.length ? clamp(scored.reduce((sum, point) => sum + (point.group[key] ?? 0), 0) / scored.length) : null;
  const reasons = new Map<string, number>();
  scored.flatMap((point) => point.members).forEach((member) => { if (member.primaryReason) reasons.set(member.primaryReason, (reasons.get(member.primaryReason) ?? 0) + 1); });
  return {
    schemaVersion: EVENT_RECOMPUTE_SCHEMA,
    family,
    runId: `sim-run-${hash(`${input.eventId}:${input.templateId}:${templateSignature}`).toString(16)}`,
    scenarioId: input.scenarioId ?? `simulation:${input.eventId}`,
    eventId: input.eventId,
    serverId,
    groupId,
    templateId: input.templateId,
    templateVersion: `sim-tpl-${hash(templateSignature).toString(16)}`,
    codeVersion: SIMULATION_CODE_VERSION,
    configVersion: SIMULATION_CONFIG_VERSION,
    startAt,
    endAt,
    frameCount: points.length,
    scoredFrameCount: scored.length,
    missingFrameCount: points.length - scored.length,
    routes,
    lifecycle,
    summary: { sync: average("sync"), route: average("route"), total: average("total") },
    rootCauses: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, occurrences]) => ({ reason, occurrences })),
    points,
  };
}

export function buildSimulationInvestigationReport(input: {
  serverId: string | number;
  from?: string | null;
  to?: string | null;
  overrides?: { eventId: string; templateId?: string | null; arena?: string | null; note?: string | null }[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const listing = listSimulationInvestigationEvents(input.serverId, input.from, input.to, now);
  if (!listing.events.length) throw new Error("no simulated events intersect the requested range");
  const overrideById = new Map((input.overrides ?? []).map((override) => [override.eventId, override]));
  const reportEvents: InvestigationPdfEvent[] = listing.events.map((event) => {
    const override = overrideById.get(event.eventId);
    const templateId = override?.templateId || event.activeTemplateId || defaultTemplate(event.family).id;
    return {
      result: recomputeSimulationEvent({ serverId: listing.serverId, eventId: event.eventId, templateId, scenarioId: `report:${event.eventId}`, now }),
      arena: override?.arena ?? getServerScenario(String(listing.serverId)).arena,
      note: override?.note ?? null,
    };
  });
  const report: InvestigationPdfReport = {
    serverId: listing.serverId,
    from: input.from ?? null,
    to: input.to ?? null,
    generatedAt: now.toISOString(),
    events: reportEvents,
  };
  return {
    source: SIMULATION_ARCHIVE_SOURCE,
    codeVersion: SIMULATION_CODE_VERSION,
    configVersion: SIMULATION_CONFIG_VERSION,
    report,
  };
}
