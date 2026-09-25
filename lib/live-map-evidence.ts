import type { EventRecomputeResult, RecomputedRoute } from "@/lib/investigation-contract";

export type LiveMapTemplateAssignment = {
  vehicleIdentifier: number;
  memberId: string;
  routeInstanceId: string;
  slotId: string;
  expectedPhase: number;
};

export type LiveMapEventEvidence = {
  serverId: number;
  groupId: string;
  eventId: string;
  templateId: string;
  routes: RecomputedRoute[];
  assignments: LiveMapTemplateAssignment[];
};

export function extractLiveMapEventEvidence(result: EventRecomputeResult): LiveMapEventEvidence {
  const point = [...result.points].reverse().find((candidate) => candidate.members.length > 0);
  const assignments = point ? point.members.flatMap((member) => {
    const navigation = point.navigation.find((row) => row.memberId === member.memberId);
    if (!navigation) return [];
    return [{
      vehicleIdentifier: navigation.vehicleIdentifier,
      memberId: member.memberId,
      routeInstanceId: member.routeInstanceId,
      slotId: member.slotId,
      expectedPhase: member.expectedPhase,
    }];
  }) : [];
  return {
    serverId: result.serverId,
    groupId: result.groupId,
    eventId: result.eventId,
    templateId: result.templateId,
    routes: result.routes,
    assignments,
  };
}
