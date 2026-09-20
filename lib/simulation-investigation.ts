import {
  EVENT_RECOMPUTE_SCHEMA,
  INVESTIGATION_EVENTS_SCHEMA,
  type EventRecomputePoint,
  type EventRecomputeResult,
  type InvestigationEventIndex,
  type InvestigationEventList,
  type RecomputedNavigation,
  type RecomputedRoute,
} from "./investigation-contract";
import { DEFAULT_WORKSPACE, getServerScenario, type Family, type SyncTemplate } from "./bluewolf";
import { buildSoSmileGeometry } from "./so-geometry";
import type { InvestigationPdfEvent, InvestigationPdfReport } from "./investigation-pdf";

/** Deliberately synthetic QA evidence. Never present this archive as observed Core telemetry. */
export const SIMULATION_ARCHIVE_DAYS = 7;
export const SIMULATION_ARCHIVE_SOURCE = "simulator-archive" as const;
export const SIMULATION_CODE_VERSION = "bluewolf-simulator-7d-v4";
export const SIMULATION_CONFIG_VERSION = "three-server-utc-stable-archive-v4";

const DAY_MS = 86_400_000;
const FRAME_COUNT = 48;
const SCHEDULE = [
  { hour: 5, minute: 20, durationMinutes: 22 },
  { hour: 9, minute: 5, durationMinutes: 31 },
  { hour: 13, minute: 40, durationMinutes: 26 },
  { hour: 18, minute: 10, durationMinutes: 38 },
] as const;
const SCENARIOS = ["nominal", "gps-noise", "turn-dropout", "formation-change", "late-data", "route-drift", "wind-gust", "route-entry-exit", "variable-period"] as const;
type SimulationEvent = InvestigationEventIndex & { seed: number; scenarioKind: string };
type Position = { latitude: number; longitude: number };

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value * 10) / 10)); }
function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); }
  return result >>> 0;
}
function signedNoise(key: string) { return hash(key) / 0xffffffff * 2 - 1; }
function serverNumber(serverId: string | number) {
  const value = Number(serverId);
  if (!Number.isInteger(value) || value < 1 || value > 3) throw new Error("simulation serverId must be 1, 2 or 3");
  return value;
}
function startOfUtcDay(value: Date) { return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()); }
function eventLifecycle(startAt: string, endAt: string, groupId: string, serverId: number, active = false) {
  return {
    status: active ? "active" as const : "closed" as const,
    openedAt: startAt, openingReason: "simulated_stable_group",
    endedAt: active ? null : endAt, endingReason: active ? null : "simulated_scenario_complete",
    finalizeAt: active ? null : endAt, closedAt: active ? null : endAt,
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
function templateList() { return DEFAULT_WORKSPACE.templates.map((template) => ({ id: template.id, name: template.name, family: template.family })); }
export function simulationActiveEventId(serverId: string | number, family: Family) {
  return `sim-s${serverNumber(serverId)}-${family.toLowerCase()}-active`;
}

/** A historical event's identity, family and seed depend on its absolute UTC
 * calendar date, never its shifting offset inside the seven-day window. */
export function simulationEvents(serverIdValue: string | number, now = new Date()): SimulationEvent[] {
  const serverId = serverNumber(serverIdValue);
  const scenario = getServerScenario(String(serverId));
  const events: SimulationEvent[] = [];
  const today = startOfUtcDay(now);
  for (let dayOffset = SIMULATION_ARCHIVE_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    const dayStart = today - dayOffset * DAY_MS;
    const utcDate = new Date(dayStart).toISOString().slice(0, 10);
    const utcDayOrdinal = Math.floor(dayStart / DAY_MS);
    SCHEDULE.forEach((slot, slotIndex) => {
      const family: Family = (utcDayOrdinal + slotIndex + serverId) % 2 === 0 ? "SI" : "SO";
      const group = family === "SI" ? scenario.groups.si : scenario.groups.so;
      const startMs = dayStart + (slot.hour * 60 + slot.minute) * 60_000;
      const endMs = startMs + slot.durationMinutes * 60_000;
      const eventId = `sim-s${serverId}-utc${utcDate}-e${slotIndex}-${family.toLowerCase()}`;
      const seed = hash(`${eventId}:${dayStart}`);
      events.push({
        eventId, serverId, groupId: group.id, family,
        startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(),
        frameCount: FRAME_COUNT, activeTemplateId: defaultTemplate(family).id,
        lifecycle: eventLifecycle(new Date(startMs).toISOString(), new Date(endMs).toISOString(), group.id, serverId),
        seed, scenarioKind: SCENARIOS[seed % SCENARIOS.length],
      });
    });
  }
  for (const family of ["SI", "SO"] as const) {
    const group = family === "SI" ? scenario.groups.si : scenario.groups.so;
    const endMs = now.getTime();
    const startMs = endMs - (family === "SI" ? 33 : 41) * 60_000;
    const eventId = simulationActiveEventId(serverId, family);
    events.push({
      eventId, serverId, groupId: group.id, family,
      startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(),
      frameCount: FRAME_COUNT, activeTemplateId: group.templateId,
      lifecycle: eventLifecycle(new Date(startMs).toISOString(), new Date(endMs).toISOString(), group.id, serverId, true),
      seed: hash(`${eventId}:${startOfUtcDay(now)}`),
      scenarioKind: family === "SO" ? "variable-period" : "wind-gust",
    });
  }
  return events.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function listSimulationInvestigationEvents(serverIdValue: string | number, from?: string | null, to?: string | null, now = new Date()): InvestigationEventList {
  const serverId = serverNumber(serverIdValue);
  const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) throw new Error("simulation investigation range is invalid");
  const events = simulationEvents(serverId, now)
    .filter((event) => Date.parse(event.endAt) >= fromMs && Date.parse(event.startAt) <= toMs)
    .map(({ seed: _seed, scenarioKind: _scenarioKind, ...event }) => event);
  return { schemaVersion: INVESTIGATION_EVENTS_SCHEMA, serverId, templates: templateList(), events };
}

function routeCenter(serverId: number) { return { latitude: 32.065 + serverId * 0.012, longitude: 34.755 + serverId * 0.014 }; }
function localToWgs84(center: Position, x: number, y: number): Position {
  return { latitude: center.latitude + y / 111_320, longitude: center.longitude + x / (111_320 * Math.cos(center.latitude * Math.PI / 180)) };
}
function offsetMeters(position: Position, east: number, north: number): Position { return localToWgs84(position, east, north); }
function circleCenterline(center: Position, radiusM = 150): Position[] {
  return Array.from({ length: 40 }, (_, index) => {
    const angle = index / 39 * Math.PI * 2;
    return localToWgs84(center, Math.cos(angle) * radiusM, Math.sin(angle) * radiusM);
  });
}
function soRoutes(serverId: number): RecomputedRoute[] {
  const center = routeCenter(serverId);
  const routes = buildSoSmileGeometry(["single", "double", "single"], {
    centerX: 0, centerY: 0, spacing: 260, risePerStep: 32, radius: 48, singleHalfLeg: 110, doubleHalfLeg: 205, samplesPerTurn: 16,
  });
  return routes.map((route, index) => ({
    routeInstanceId: `so-r${index + 1}`, routeId: `sim-so-${serverId}-${index + 1}`,
    family: "SO", subtype: route.kind === "double" ? "double_hippodrome" : "hippodrome",
    topology: route.kind === "double" ? "double" : "single",
    centerLatitude: localToWgs84(center, route.center.x, route.center.y).latitude,
    centerLongitude: localToWgs84(center, route.center.x, route.center.y).longitude,
    lengthM: route.kind === "double" ? 1_120 : 650,
    longAxisAM: route.kind === "double" ? 220 : 125, shortAxisBM: 48,
    orientationDeg: route.rotationDeg, estimatedPeriodS: route.kind === "double" ? 300 : 150,
    direction: "clockwise", detectionQuality: 0.9,
    centerline: route.points.map((point) => localToWgs84(center, point.x, point.y)),
  }));
}
function siRoutes(serverId: number): RecomputedRoute[] {
  const center = routeCenter(serverId);
  return [{
    routeInstanceId: "si-r1", routeId: `sim-si-${serverId}`, family: "SI", subtype: "compact_closed", topology: "closed",
    centerLatitude: center.latitude, centerLongitude: center.longitude, lengthM: 2 * Math.PI * 150,
    longAxisAM: 150, shortAxisBM: 150, orientationDeg: 0, estimatedPeriodS: 180,
    direction: "clockwise", detectionQuality: 0.94, centerline: circleCenterline(center),
  }];
}
function interpolateLine(points: Position[], phase: number): Position {
  const normalized = ((phase % 1) + 1) % 1;
  const index = Math.min(points.length - 2, Math.floor(normalized * (points.length - 1)));
  const local = normalized * (points.length - 1) - index;
  const first = points[index], second = points[index + 1];
  return { latitude: first.latitude + (second.latitude - first.latitude) * local, longitude: first.longitude + (second.longitude - first.longitude) * local };
}
function chosenTemplate(templateId: string, family: Family, explicit?: Partial<SyncTemplate> | null): Partial<SyncTemplate> & Pick<SyncTemplate, "id" | "family"> {
  if (explicit?.id === templateId && explicit.family === family) return { ...explicit, id: templateId, family };
  return DEFAULT_WORKSPACE.templates.find((template) => template.id === templateId && template.family === family)
    ?? { id: templateId, family, values: [], soSpec: undefined, siPositions: undefined };
}

/** Reproducible vehicle navigation sampled by event time, not an offset of a perfect route. */
function simulatedNavigation(input: {
  eventId: string; kind: string; seed: number; serverId: number;
  route: RecomputedRoute; vehicleId: number; memberIndex: number; frameIndex: number;
  elapsedS: number; durationS: number;
}): { nav: RecomputedNavigation; errorM: number; phase: number; periodS: number } {
  const { eventId, kind, seed, serverId, route, vehicleId, memberIndex, frameIndex, elapsedS, durationS } = input;
  const normalizedTime = Math.max(0, Math.min(1, elapsedS / Math.max(1, durationS)));
  const gust = kind === "wind-gust" || kind === "route-drift" ? 1.9 : 1;
  const noiseAmpM = kind === "gps-noise" ? 28 : kind === "nominal" ? 3.4 : 9;
  const basePeriod = route.estimatedPeriodS * (1 + .08 * Math.sin(seed * .0001 + memberIndex + serverId));
  const periodVariation = kind === "variable-period" || kind === "formation-change" ? .22 : .075;
  const periodS = basePeriod * (1 + periodVariation * Math.sin(normalizedTime * Math.PI * 3 + memberIndex * .7 + serverId));
  const evolvingPhase = elapsedS / basePeriod - (periodVariation / (Math.PI * 3)) * Math.cos(normalizedTime * Math.PI * 3 + memberIndex * .7 + serverId) * durationS / basePeriod;
  const phase = ((evolvingPhase + memberIndex / 5 + (kind === "formation-change" && normalizedTime > .52 ? .14 : 0)) % 1 + 1) % 1;
  const onRoute = interpolateLine(route.centerline, phase);
  const smoothWindEast = (10 + 13 * Math.sin(normalizedTime * Math.PI * 4 + serverId)) * gust;
  const smoothWindNorth = (9 * Math.cos(normalizedTime * Math.PI * 3 + serverId * .8)) * gust;
  const exit = kind === "route-entry-exit" || kind === "route-drift";
  const excursion = exit ? Math.max(0, 1 - Math.abs(normalizedTime - .5) / .26) * (kind === "route-drift" ? 85 : 125) : 0;
  const gpsEast = signedNoise(`${eventId}:${vehicleId}:${frameIndex}:east`) * noiseAmpM;
  const gpsNorth = signedNoise(`${eventId}:${vehicleId}:${frameIndex}:north`) * noiseAmpM;
  const eastM = smoothWindEast + gpsEast + excursion * Math.cos(memberIndex * 1.3 + serverId);
  const northM = smoothWindNorth + gpsNorth + excursion * Math.sin(memberIndex * 1.3 + serverId);
  const observed = offsetMeters(onRoute, eastM, northM);
  const tangent = interpolateLine(route.centerline, phase + .001);
  const deltaNorth = (tangent.latitude - onRoute.latitude) * 111_320;
  const deltaEast = (tangent.longitude - onRoute.longitude) * 111_320 * Math.cos(onRoute.latitude * Math.PI / 180);
  const direction = Math.atan2(deltaEast, deltaNorth);
  const effectiveSpeedMps = route.lengthM / Math.max(1, periodS);
  const headingDeg = ((direction * 180 / Math.PI) % 360 + 360) % 360;
  const reliability = kind === "gps-noise" ? .75 : kind === "turn-dropout" && frameIndex % 12 === 0 ? .58 : .92;
  return {
    phase, periodS, errorM: Math.hypot(eastM, northM),
    nav: {
      memberId: String(vehicleId), vehicleIdentifier: vehicleId,
      latitude: observed.latitude, longitude: observed.longitude,
      altitudeM: 45 + memberIndex * 3 + signedNoise(`${eventId}:${vehicleId}:${frameIndex}:alt`) * 5,
      velocityNorthMps: Math.cos(direction) * effectiveSpeedMps,
      velocityEastMps: Math.sin(direction) * effectiveSpeedMps,
      headingDeg, active: true, reliability,
    },
  };
}

export function recomputeSimulationEvent(input: {
  serverId: string | number; eventId: string; templateId: string; scenarioId?: string;
  groupId?: string; family?: Family; template?: Partial<SyncTemplate> | null; now?: Date;
}): EventRecomputeResult {
  const serverId = serverNumber(input.serverId);
  const now = input.now ?? new Date();
  const event = simulationEvents(serverId, now).find((candidate) => candidate.eventId === input.eventId);
  if (!event) throw new Error("simulation eventId is not present in the requested server archive");
  if (input.family && input.family !== event.family) throw new Error("simulation event family does not match archive");
  if (input.groupId && input.groupId !== event.groupId) throw new Error("simulation event group does not match archive");
  const family = event.family;
  const scenario = getServerScenario(String(serverId));
  const group = family === "SI" ? scenario.groups.si : scenario.groups.so;
  const groupId = event.groupId;
  const startAt = event.startAt;
  const endAt = event.endAt;
  const lifecycle = event.lifecycle;
  const seed = event.seed;
  const scenarioKind = event.scenarioKind;
  const template = chosenTemplate(input.templateId, family, input.template);
  const templateSignature = JSON.stringify([template.id, template.values ?? [], template.soSpec?.chain ?? [], template.siPositions ?? []]);
  const templatePenalty = hash(templateSignature) % 15;
  const routes = family === "SI" ? siRoutes(serverId) : soRoutes(serverId);
  const memberRows = group.members.slice(0, family === "SI" ? 3 : 4);
  const startMs = Date.parse(startAt), endMs = Date.parse(endAt);
  const durationS = Math.max(1, (endMs - startMs) / 1000);
  const scenarioPenalty = [0, 6, 11, 14, 8, 10, 12, 15, 9][seed % 9];
  const points: EventRecomputePoint[] = Array.from({ length: FRAME_COUNT }, (_, frameIndex) => {
    const elapsedS = durationS * frameIndex / Math.max(1, FRAME_COUNT - 1);
    const observedAt = new Date(startMs + elapsedS * 1000).toISOString();
    const missing = (seed % 3 === 1 && (frameIndex === 14 || frameIndex === 15)) || (seed % 5 === 0 && frameIndex === 29)
      || (scenarioKind === "turn-dropout" && frameIndex % 13 === 0);
    if (missing) return { observedAt, pendingReason: "simulated_observability_gap", group: { valid: false, sync: null, route: null, total: null }, members: [], navigation: [] };
    const samples = memberRows.map((vehicle, memberIndex) => {
      const route = family === "SI" ? routes[0] : routes[Math.min(routes.length - 1, memberIndex % routes.length)];
      return simulatedNavigation({ eventId: input.eventId, kind: scenarioKind, seed, serverId, route, vehicleId: vehicle.id, memberIndex, frameIndex, elapsedS, durationS });
    });
    const phase = frameIndex / Math.max(1, FRAME_COUNT - 1);
    const maxError = Math.max(...samples.map((sample) => sample.errorM), 0);
    const groupRoute = clamp(98 - scenarioPenalty * .25 - maxError * .29);
    const periodSpread = Math.max(...samples.map((sample) => sample.periodS)) - Math.min(...samples.map((sample) => sample.periodS));
    const groupSync = clamp(96 - scenarioPenalty - templatePenalty * .7 - periodSpread * .16 + Math.sin(phase * Math.PI * 4 + serverId) * 5);
    const members = memberRows.map((vehicle, memberIndex) => {
      const sample = samples[memberIndex];
      const memberSync = clamp(groupSync + (memberIndex - 1.5) * 2.6 - (scenarioKind === "formation-change" && phase > .52 ? memberIndex * 6 : 0));
      const memberRoute = clamp(99 - sample.errorM * .34 - scenarioPenalty * .15);
      return {
        memberId: String(vehicle.id), routeInstanceId: family === "SI" ? "si-r1" : `so-r${Math.min(3, memberIndex % routes.length + 1)}`,
        slotId: `${family.toLowerCase()}-slot-${memberIndex + 1}`, expectedPhase: sample.phase,
        positionErrorCycle: Math.abs(100 - memberSync) / 300,
        valid: true, sync: memberSync, route: memberRoute,
        total: clamp(memberSync * .75 + memberRoute * .25),
        primaryReason: memberSync < memberRoute ? (family === "SI" ? "si_relative_angle" : "so_template_phase") : "route_adherence",
      };
    });
    return {
      observedAt, pendingReason: null,
      group: { valid: true, sync: groupSync, route: groupRoute, total: clamp(groupSync * .75 + groupRoute * .25) },
      members, navigation: samples.map((sample) => sample.nav),
    };
  });
  const scored = points.filter((point) => point.pendingReason === null);
  const average = (key: "sync" | "route" | "total") => scored.length ? clamp(scored.reduce((sum, point) => sum + (point.group[key] ?? 0), 0) / scored.length) : null;
  const reasons = new Map<string, number>();
  scored.flatMap((point) => point.members).forEach((member) => { if (member.primaryReason) reasons.set(member.primaryReason, (reasons.get(member.primaryReason) ?? 0) + 1); });
  return {
    schemaVersion: EVENT_RECOMPUTE_SCHEMA, family,
    runId: `sim-run-${hash(`${input.eventId}:${input.templateId}:${templateSignature}`).toString(16)}`,
    scenarioId: input.scenarioId ?? `simulation:${scenarioKind}:${input.eventId}`,
    eventId: input.eventId, serverId, groupId, templateId: input.templateId,
    templateVersion: `sim-tpl-${hash(templateSignature).toString(16)}`,
    codeVersion: SIMULATION_CODE_VERSION, configVersion: SIMULATION_CONFIG_VERSION,
    startAt, endAt, frameCount: points.length, scoredFrameCount: scored.length,
    missingFrameCount: points.length - scored.length, routes, lifecycle,
    summary: { sync: average("sync"), route: average("route"), total: average("total") },
    rootCauses: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, occurrences]) => ({ reason, occurrences })),
    points,
  };
}

export function buildSimulationInvestigationReport(input: {
  serverId: string | number; from?: string | null; to?: string | null;
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
    serverId: listing.serverId, from: input.from ?? null, to: input.to ?? null,
    generatedAt: now.toISOString(), events: reportEvents,
  };
  return { source: SIMULATION_ARCHIVE_SOURCE, codeVersion: SIMULATION_CODE_VERSION, configVersion: SIMULATION_CONFIG_VERSION, report };
}
