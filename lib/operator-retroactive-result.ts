import type { DemoGroup } from "./bluewolf";
import type { EventRecomputeResult } from "./investigation-contract";
import type { LiveRuntimeHistoryPoint } from "./live-runtime-history";
import { validObservedWgs84 } from "./observed-navigation-continuity";
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
      source: result.source,
    };
    const existingSynthetic = existing.source?.syntheticNavigation === true;
    const recomputeSynthetic = result.source?.syntheticNavigation === true;
    if ((existing.source !== undefined || result.source !== undefined) && existingSynthetic !== recomputeSynthetic) {
      throw new Error("recompute history source provenance does not match existing point");
    }
    if (result.source) existing.source = { ...result.source };
    existing.groups = existing.groups.filter((row) => !(row.id === result.groupId && row.event?.id === result.eventId));
    existing.groups.push({
      id: result.groupId,
      name: group.name,
      color: group.color,
      total: point.group.total ?? 0,
      rawTotal: point.group.valid && point.group.rawTotal !== null ? point.group.rawTotal : undefined,
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
  // Replace only the exact group/event; another group may have the same event ID.
  const kept = previous.filter((point) => !(point.groupId === result.groupId && point.eventId === result.eventId));
  const recomputed: ScoreTracePoint[] = [];
  const lastObservedByVehicle = new Map<number, ScoreTracePoint>();
  // The archive may arrive in reverse order. Continuity is defined only by
  // observed source time, not by transport/array order or the render clock.
  for (const point of [...result.points].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))) {
    const timeMs = Date.parse(point.observedAt);
    const memberById = new Map(point.members.map((member) => [member.memberId, member]));
    const positioned = new Set<number>();
    for (const nav of point.navigation) {
      const prior = lastObservedByVehicle.get(nav.vehicleIdentifier);
      if (nav.latitude === null || nav.longitude === null || !validObservedWgs84({ latitude: nav.latitude, longitude: nav.longitude })) {
        if (prior && prior.timeMs < timeMs) prior.breakAfter = true;
        continue;
      }
      positioned.add(nav.vehicleIdentifier);
      const observed: ScoreTracePoint = {
        timeMs,
        groupId: result.groupId,
        eventId: result.eventId,
        vehicleId: nav.vehicleIdentifier,
        latitude: nav.latitude,
        longitude: nav.longitude,
        sync: memberById.get(nav.memberId)?.sync ?? null,
      };
      recomputed.push(observed);
      lastObservedByVehicle.set(nav.vehicleIdentifier, observed);
    }
    // A vehicle omitted entirely from this archive frame is also a known
    // missing fix. Keep its prior real point, but do not join it to a later one.
    for (const [vehicleId, prior] of lastObservedByVehicle) {
      if (!positioned.has(vehicleId) && prior.timeMs < timeMs) prior.breakAfter = true;
    }
  }
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
