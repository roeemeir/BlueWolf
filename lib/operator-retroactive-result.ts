import type { DemoGroup } from "./bluewolf";
import type { EventRecomputeResult } from "./investigation-contract";
import type { LiveRuntimeHistoryPoint } from "./live-runtime-history";
import type { ScoreTracePoint } from "./score-trace";

function latestScoredPoint(result: EventRecomputeResult) {
  return [...result.points].reverse().find((point) => point.group.valid && point.group.total !== null) ?? null;
}

export function groupFromEventRecompute<T extends DemoGroup>(group: T, result: EventRecomputeResult): T {
  if (group.id !== result.groupId) return group;
  const point = latestScoredPoint(result);
  if (!point) return group;
  const vehicleIdByMember = new Map(point.navigation.map((row) => [row.memberId, row.vehicleIdentifier]));
  const scoresByVehicle = new Map(point.members.flatMap((member) => {
    const vehicleId = vehicleIdByMember.get(member.memberId);
    return vehicleId === undefined ? [] : [[vehicleId, member] as const];
  }));
  return {
    ...group,
    total: point.group.total ?? group.total,
    sync: point.group.sync ?? group.sync,
    route: point.group.route ?? group.route,
    templateId: result.templateId,
    reason: result.rootCauses[0]?.reason ?? group.reason,
    success: `Recomputed event ${result.eventId} · run ${result.runId}`,
    members: group.members.map((vehicle) => {
      const score = scoresByVehicle.get(vehicle.id);
      if (!score) return vehicle;
      return {
        ...vehicle,
        score: score.total ?? vehicle.score,
        sync: score.sync ?? vehicle.sync,
        route: score.route ?? vehicle.route,
      };
    }),
  } as T;
}

export function historyWithEventRecompute(
  previous: LiveRuntimeHistoryPoint[],
  result: EventRecomputeResult,
  group: Pick<DemoGroup, "id" | "name" | "color">,
): LiveRuntimeHistoryPoint[] {
  if (group.id !== result.groupId) return previous;
  const byTime = new Map(previous.map((point) => [point.observedAt, structuredClone(point)]));
  for (const point of result.points) {
    const existing = byTime.get(point.observedAt) ?? {
      schemaVersion: "bluewolf.live-runtime-history.v1" as const,
      serverId: String(result.serverId),
      observedAt: point.observedAt,
      groups: [],
    };
    existing.groups = existing.groups.filter((row) => !(row.id === result.groupId && row.event?.id === result.eventId));
    existing.groups.push({
      id: result.groupId,
      name: group.name,
      color: group.color,
      total: point.group.total ?? 0,
      sync: point.group.sync ?? 0,
      route: point.group.route ?? 0,
      scoreValid: point.group.valid,
      event: { id: result.eventId, active: result.lifecycle.status === "active" || result.lifecycle.status === "finalizing" },
    });
    byTime.set(point.observedAt, existing);
  }
  return [...byTime.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

export function traceWithEventRecompute(previous: ScoreTracePoint[], result: EventRecomputeResult): ScoreTracePoint[] {
  // An event ID is not a license to delete another group's observations.
  // The recomputation replaces only its exact group/event identity; a separate
  // group may legitimately retain same-named event evidence in a multi-group
  // or cross-source report snapshot.
  const kept = previous.filter((point) => !(point.groupId === result.groupId && point.eventId === result.eventId));
  const recomputed = result.points.flatMap((point) => {
    const memberById = new Map(point.members.map((member) => [member.memberId, member]));
    return point.navigation.flatMap((nav) => {
      if (nav.latitude === null || nav.longitude === null) return [];
      return [{
        timeMs: Date.parse(point.observedAt),
        groupId: result.groupId,
        eventId: result.eventId,
        vehicleId: nav.vehicleIdentifier,
        latitude: nav.latitude,
        longitude: nav.longitude,
        sync: memberById.get(nav.memberId)?.sync ?? null,
      } satisfies ScoreTracePoint];
    });
  });
  return [...kept, ...recomputed].sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId);
}

export function sameRecomputeVersion(
  result: EventRecomputeResult,
  expected: { eventId: string; templateId: string; codeVersion: string; configVersion: string; templateVersion: string },
) {
  return result.eventId === expected.eventId
    && result.templateId === expected.templateId
    && result.codeVersion === expected.codeVersion
    && result.configVersion === expected.configVersion
    && result.templateVersion === expected.templateVersion;
}
