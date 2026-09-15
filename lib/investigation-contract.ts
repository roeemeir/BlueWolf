export const INVESTIGATION_EVENTS_SCHEMA = "bluewolf.investigation-events.v1" as const;
export const EVENT_RECOMPUTE_SCHEMA = "bluewolf.event-recompute.v1" as const;

export type InvestigationTemplate = { id: string; name: string };

export type InvestigationEventIndex = {
  eventId: string;
  serverId: number;
  groupId: string;
  startAt: string;
  endAt: string;
  frameCount: number;
  activeTemplateId: string | null;
};

export type InvestigationEventList = {
  schemaVersion: typeof INVESTIGATION_EVENTS_SCHEMA;
  serverId: number;
  templates: InvestigationTemplate[];
  events: InvestigationEventIndex[];
};

export type RecomputedMember = {
  memberId: string;
  routeInstanceId: string;
  slotId: string;
  expectedPhase: number;
  positionErrorCycle: number;
  valid: boolean;
  sync: number | null;
  route: number | null;
  total: number | null;
  primaryReason: string | null;
};

export type RecomputedNavigation = {
  memberId: string;
  vehicleIdentifier: number;
  latitude: number | null;
  longitude: number | null;
  altitudeM: number | null;
  velocityNorthMps: number | null;
  velocityEastMps: number | null;
  headingDeg: number | null;
  active: boolean | null;
  reliability: number;
};

export type RecomputedRoute = {
  routeInstanceId: string;
  routeId: string;
  family: string;
  subtype: string;
  topology: string;
  centerLatitude: number;
  centerLongitude: number;
  lengthM: number;
  longAxisAM: number;
  shortAxisBM: number;
  orientationDeg: number;
  estimatedPeriodS: number;
  direction: string;
  detectionQuality: number;
  centerline: { latitude: number; longitude: number }[];
};

export type EventRecomputePoint = {
  observedAt: string;
  pendingReason: string | null;
  group: { valid: boolean; sync: number | null; route: number | null; total: number | null };
  members: RecomputedMember[];
  navigation: RecomputedNavigation[];
};

export type EventRecomputeResult = {
  schemaVersion: typeof EVENT_RECOMPUTE_SCHEMA;
  runId: string;
  scenarioId: string;
  eventId: string;
  serverId: number;
  groupId: string;
  templateId: string;
  templateVersion: string;
  codeVersion: string;
  configVersion: string;
  startAt: string;
  endAt: string;
  frameCount: number;
  scoredFrameCount: number;
  missingFrameCount: number;
  routes: RecomputedRoute[];
  summary: { sync: number | null; route: number | null; total: number | null };
  rootCauses: { reason: string; occurrences: number }[];
  points: EventRecomputePoint[];
};

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} is missing`);
  return value;
}

function optionalText(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, name);
}

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

function time(value: unknown, name: string): string {
  const result = text(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} is invalid`);
  return result;
}

function score(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} must be null or in [0,100]`);
  return value;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function positive(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result <= 0) throw new Error(`${name} must be positive`);
  return result;
}

function finiteOrNull(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  return finite(value, name);
}

function wgs84(latitudeValue: unknown, longitudeValue: unknown, name: string) {
  const latitude = finite(latitudeValue, `${name} latitude`);
  const longitude = finite(longitudeValue, `${name} longitude`);
  if (latitude < -90 || latitude > 90) throw new Error(`${name} latitude is outside WGS84 range`);
  if (longitude < -180 || longitude > 180) throw new Error(`${name} longitude is outside WGS84 range`);
  return { latitude, longitude };
}

export function normalizeInvestigationEvents(value: unknown): InvestigationEventList {
  const row = object(value, "investigation event list");
  if (row.schemaVersion !== INVESTIGATION_EVENTS_SCHEMA) throw new Error("unsupported investigation event schema");
  const serverId = integer(row.serverId, "serverId");
  if (!Array.isArray(row.events)) throw new Error("events must be an array");
  if (!Array.isArray(row.templates)) throw new Error("templates must be an array");
  const templates = row.templates.map((item, index) => {
    const template = object(item, `template ${index + 1}`);
    return { id: text(template.id, "template id"), name: text(template.name, "template name") };
  });
  if (new Set(templates.map((template) => template.id)).size !== templates.length) throw new Error("template ids must be unique");
  const events = row.events.map((item, index) => {
    const event = object(item, `event ${index + 1}`);
    const eventServerId = integer(event.serverId, "event serverId");
    if (eventServerId !== serverId) throw new Error("event belongs to a different server");
    return {
      eventId: text(event.eventId, "eventId"),
      serverId: eventServerId,
      groupId: text(event.groupId, "groupId"),
      startAt: time(event.startAt, "startAt"),
      endAt: time(event.endAt, "endAt"),
      frameCount: integer(event.frameCount, "frameCount"),
      activeTemplateId: optionalText(event.activeTemplateId, "activeTemplateId"),
    };
  });
  return { schemaVersion: INVESTIGATION_EVENTS_SCHEMA, serverId, templates, events };
}

export function normalizeEventRecompute(value: unknown): EventRecomputeResult {
  const row = object(value, "event recompute result");
  if (row.schemaVersion !== EVENT_RECOMPUTE_SCHEMA) throw new Error("unsupported event recompute schema");
  const summary = object(row.summary, "summary");
  if (!Array.isArray(row.rootCauses)) throw new Error("rootCauses must be an array");
  if (!Array.isArray(row.points)) throw new Error("points must be an array");
  const routeRows = row.routes === undefined ? [] : row.routes;
  if (!Array.isArray(routeRows)) throw new Error("routes must be an array");
  const frameCount = integer(row.frameCount, "frameCount");
  const scoredFrameCount = integer(row.scoredFrameCount, "scoredFrameCount");
  const missingFrameCount = integer(row.missingFrameCount, "missingFrameCount");
  if (scoredFrameCount + missingFrameCount !== frameCount) throw new Error("scoredFrameCount + missingFrameCount must equal frameCount");
  if (row.points.length !== frameCount) throw new Error("points length must equal frameCount");
  const rootCauses = row.rootCauses.map((item, index) => {
    const cause = object(item, `rootCause ${index + 1}`);
    return { reason: text(cause.reason, "root cause reason"), occurrences: integer(cause.occurrences, "root cause occurrences") };
  });
  const routes = routeRows.map((raw, routeIndex) => {
    const route = object(raw, `route ${routeIndex + 1}`);
    if (!Array.isArray(route.centerline) || route.centerline.length < 3) throw new Error("route centerline must contain at least three points");
    const center = wgs84(route.centerLatitude, route.centerLongitude, "route center");
    const centerline = route.centerline.map((pointRaw, pointIndex) => {
      const point = object(pointRaw, `route centerline point ${pointIndex + 1}`);
      return wgs84(point.latitude, point.longitude, "route centerline point");
    });
    const detectionQuality = finite(route.detectionQuality, "route detectionQuality");
    if (detectionQuality < 0 || detectionQuality > 1) throw new Error("route detectionQuality must be in [0,1]");
    return {
      routeInstanceId: text(route.routeInstanceId, "routeInstanceId"),
      routeId: text(route.routeId, "routeId"),
      family: text(route.family, "route family"),
      subtype: text(route.subtype, "route subtype"),
      topology: text(route.topology, "route topology"),
      centerLatitude: center.latitude,
      centerLongitude: center.longitude,
      lengthM: positive(route.lengthM, "route lengthM"),
      longAxisAM: positive(route.longAxisAM, "route longAxisAM"),
      shortAxisBM: positive(route.shortAxisBM, "route shortAxisBM"),
      orientationDeg: finite(route.orientationDeg, "route orientationDeg"),
      estimatedPeriodS: positive(route.estimatedPeriodS, "route estimatedPeriodS"),
      direction: text(route.direction, "route direction"),
      detectionQuality,
      centerline,
    };
  });
  if (new Set(routes.map((route) => route.routeInstanceId)).size !== routes.length) throw new Error("route instance ids must be unique");
  const points = row.points.map((item, pointIndex) => {
    const point = object(item, `point ${pointIndex + 1}`);
    const group = object(point.group, "group score");
    if (typeof group.valid !== "boolean") throw new Error("group valid must be boolean");
    if (!Array.isArray(point.members)) throw new Error("members must be an array");
    const navigationRows = point.navigation === undefined ? [] : point.navigation;
    if (!Array.isArray(navigationRows)) throw new Error("navigation must be an array");
    const pendingReason = point.pendingReason === null ? null : text(point.pendingReason, "pendingReason");
    const members = point.members.map((raw, memberIndex) => {
      const member = object(raw, `member ${memberIndex + 1}`);
      if (typeof member.valid !== "boolean") throw new Error("member valid must be boolean");
      return {
        memberId: text(member.memberId, "memberId"),
        routeInstanceId: text(member.routeInstanceId, "routeInstanceId"),
        slotId: text(member.slotId, "slotId"),
        expectedPhase: finite(member.expectedPhase, "expectedPhase"),
        positionErrorCycle: finite(member.positionErrorCycle, "positionErrorCycle"),
        valid: member.valid,
        sync: score(member.sync, "member sync"),
        route: score(member.route, "member route"),
        total: score(member.total, "member total"),
        primaryReason: member.primaryReason === null ? null : text(member.primaryReason, "primaryReason"),
      };
    });
    const navigation = navigationRows.map((raw, navigationIndex) => {
      const nav = object(raw, `navigation ${navigationIndex + 1}`);
      const latitude = finiteOrNull(nav.latitude, "navigation latitude");
      const longitude = finiteOrNull(nav.longitude, "navigation longitude");
      if ((latitude === null) !== (longitude === null)) throw new Error("navigation latitude/longitude must both exist or both be null");
      if (latitude !== null && (latitude < -90 || latitude > 90)) throw new Error("navigation latitude is outside WGS84 range");
      if (longitude !== null && (longitude < -180 || longitude > 180)) throw new Error("navigation longitude is outside WGS84 range");
      const headingDeg = finiteOrNull(nav.headingDeg, "navigation headingDeg");
      if (headingDeg !== null && (headingDeg < 0 || headingDeg >= 360)) throw new Error("navigation headingDeg must be in [0,360)");
      const reliability = finite(nav.reliability, "navigation reliability");
      if (reliability < 0 || reliability > 1) throw new Error("navigation reliability must be in [0,1]");
      if (nav.active !== null && typeof nav.active !== "boolean") throw new Error("navigation active must be boolean or null");
      return {
        memberId: text(nav.memberId, "navigation memberId"),
        vehicleIdentifier: integer(nav.vehicleIdentifier, "navigation vehicleIdentifier"),
        latitude,
        longitude,
        altitudeM: finiteOrNull(nav.altitudeM, "navigation altitudeM"),
        velocityNorthMps: finiteOrNull(nav.velocityNorthMps, "navigation velocityNorthMps"),
        velocityEastMps: finiteOrNull(nav.velocityEastMps, "navigation velocityEastMps"),
        headingDeg,
        active: nav.active as boolean | null,
        reliability,
      };
    });
    if (new Set(navigation.map((item) => item.memberId)).size !== navigation.length) throw new Error("navigation member ids must be unique per frame");
    if (new Set(navigation.map((item) => item.vehicleIdentifier)).size !== navigation.length) throw new Error("navigation vehicle identifiers must be unique per frame");
    const normalizedGroup = {
      valid: group.valid,
      sync: score(group.sync, "group sync"),
      route: score(group.route, "group route"),
      total: score(group.total, "group total"),
    };
    if (pendingReason !== null) {
      if (normalizedGroup.valid || normalizedGroup.sync !== null || normalizedGroup.route !== null || normalizedGroup.total !== null) throw new Error("pending point must not contain a valid group score");
      if (members.length !== 0) throw new Error("pending point must not contain recomputed members");
    }
    return {
      observedAt: time(point.observedAt, "observedAt"),
      pendingReason,
      group: normalizedGroup,
      members,
      navigation,
    };
  });
  const observedMissing = points.filter((point) => point.pendingReason !== null).length;
  if (observedMissing !== missingFrameCount) throw new Error("missingFrameCount does not match pending points");
  return {
    schemaVersion: EVENT_RECOMPUTE_SCHEMA,
    runId: text(row.runId, "runId"),
    scenarioId: text(row.scenarioId, "scenarioId"),
    eventId: text(row.eventId, "eventId"),
    serverId: integer(row.serverId, "serverId"),
    groupId: text(row.groupId, "groupId"),
    templateId: text(row.templateId, "templateId"),
    templateVersion: text(row.templateVersion, "templateVersion"),
    codeVersion: text(row.codeVersion, "codeVersion"),
    configVersion: text(row.configVersion, "configVersion"),
    startAt: time(row.startAt, "startAt"),
    endAt: time(row.endAt, "endAt"),
    frameCount,
    scoredFrameCount,
    missingFrameCount,
    routes,
    summary: {
      sync: score(summary.sync, "summary sync"),
      route: score(summary.route, "summary route"),
      total: score(summary.total, "summary total"),
    },
    rootCauses,
    points,
  };
}
