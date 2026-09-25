import type { EventRecomputeResult } from "./investigation-contract";

/** An upstream HTTP-200 result is not evidence that it belongs to the selected
 * server/event/template. Fail closed rather than presenting another group as
 * the requested investigation. This helper must live outside a Next.js route
 * handler module, which only permits supported handler/configuration exports. */
export function verifyRecomputeResponseIdentity(request: Record<string, unknown>, result: EventRecomputeResult): string | null {
  if (typeof request.eventId !== "string" || !request.eventId.trim()) return "recomputation request is missing eventId";
  if (typeof request.templateId !== "string" || !request.templateId.trim()) return "recomputation request is missing templateId";
  if (result.eventId !== request.eventId) return "Python Core recomputation eventId does not match request";
  if (result.templateId !== request.templateId) return "Python Core recomputation templateId does not match request";
  if (request.serverId !== undefined && request.serverId !== null) {
    const serverId = typeof request.serverId === "string" || typeof request.serverId === "number" ? Number(request.serverId) : Number.NaN;
    if (!Number.isInteger(serverId) || serverId !== result.serverId) return "Python Core recomputation serverId does not match request";
  }
  if (typeof request.groupId === "string" && request.groupId && result.groupId !== request.groupId) return "Python Core recomputation groupId does not match request";
  if ((request.family === "SI" || request.family === "SO") && result.family !== request.family) return "Python Core recomputation family does not match request";
  return null;
}
