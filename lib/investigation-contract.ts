export const INVESTIGATION_EVENTS_SCHEMA = "bluewolf.investigation-events.v1" as const;
export const EVENT_RECOMPUTE_SCHEMA = "bluewolf.event-recompute.v1" as const;

export type InvestigationEventIndex = {
  eventId: string;
  serverId: number;
  groupId: string;
  startAt: string;
  endAt: string;
  frameCount: number;
};

export type InvestigationEventList = {
  schemaVersion: typeof INVESTIGATION_EVENTS_SCHEMA;
  serverId: number;
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
  summary: { sync: number | null; route: number | null; total: number | null };
  rootCauses: { reason: string; occurrences: number }[];
  points: {
    observedAt: string;
    group: { valid: boolean; sync: number | null; route: number | null; total: number | null };
    members: RecomputedMember[];
  }[];
};

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} is missing`);
  return value;
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

export function normalizeInvestigationEvents(value: unknown): InvestigationEventList {
  const row = object(value, "investigation event list");
  if (row.schemaVersion !== INVESTIGATION_EVENTS_SCHEMA) throw new Error("unsupported investigation event schema");
  const serverId = integer(row.serverId, "serverId");
  if (!Array.isArray(row.events)) throw new Error("events must be an array");
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
    };
  });
  return { schemaVersion: INVESTIGATION_EVENTS_SCHEMA, serverId, events };
}

export function normalizeEventRecompute(value: unknown): EventRecomputeResult {
  const row = object(value, "event recompute result");
  if (row.schemaVersion !== EVENT_RECOMPUTE_SCHEMA) throw new Error("unsupported event recompute schema");
  const summary = object(row.summary, "summary");
  if (!Array.isArray(row.rootCauses)) throw new Error("rootCauses must be an array");
  if (!Array.isArray(row.points)) throw new Error("points must be an array");
  const rootCauses = row.rootCauses.map((item, index) => {
    const cause = object(item, `rootCause ${index + 1}`);
    return { reason: text(cause.reason, "root cause reason"), occurrences: integer(cause.occurrences, "root cause occurrences") };
  });
  const points = row.points.map((item, pointIndex) => {
    const point = object(item, `point ${pointIndex + 1}`);
    const group = object(point.group, "group score");
    if (typeof group.valid !== "boolean") throw new Error("group valid must be boolean");
    if (!Array.isArray(point.members)) throw new Error("members must be an array");
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
    return {
      observedAt: time(point.observedAt, "observedAt"),
      group: {
        valid: group.valid,
        sync: score(group.sync, "group sync"),
        route: score(group.route, "group route"),
        total: score(group.total, "group total"),
      },
      members,
    };
  });
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
    frameCount: integer(row.frameCount, "frameCount"),
    summary: {
      sync: score(summary.sync, "summary sync"),
      route: score(summary.route, "summary route"),
      total: score(summary.total, "summary total"),
    },
    rootCauses,
    points,
  };
}
