import { recomputeSimulationEvent } from "@/lib/simulation-investigation";
import { normalizeEventRecompute, type EventRecomputeResult } from "@/lib/investigation-contract";
import type { SyncTemplate } from "@/lib/bluewolf";

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

/** A successful upstream HTTP response is not evidence that it recomputed the
 * requested event. Do not display or persist another server/event/template as
 * the selected investigation result. Older clients can omit serverId; whenever
 * it is supplied it must agree with the Core-owned source result. */
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

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ status: "error", error: "request must be valid JSON" }, { status: 400 }); }
  const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (row.source === "simulation") {
    try {
      const result = recomputeSimulationEvent({
        serverId: Number(row.serverId),
        eventId: String(row.eventId ?? ""),
        templateId: String(row.templateId ?? ""),
        scenarioId: typeof row.scenarioId === "string" ? row.scenarioId : undefined,
        groupId: typeof row.groupId === "string" ? row.groupId : undefined,
        family: row.family === "SI" || row.family === "SO" ? row.family : undefined,
        template: row.template && typeof row.template === "object" && !Array.isArray(row.template) ? row.template as Partial<SyncTemplate> : undefined,
      });
      return Response.json(normalizeEventRecompute(result), { headers: { "cache-control": "no-store", "x-bluewolf-investigation": "simulator-archive" } });
    } catch (error) {
      return Response.json({ status: "error", error: error instanceof Error ? error.message : "simulation recomputation failed" }, { status: 422 });
    }
  }
  const { baseUrl, token } = runtimeConfig();
  if (!baseUrl) return Response.json({ status: "unavailable", error: "Python Core investigation recomputation is not configured" }, { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${baseUrl}/v1/investigation/recompute`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { return Response.json({ status: "error", error: "Python Core recomputation returned invalid JSON" }, { status: 502 }); }
    if (response.status === 404 || response.status === 422) return Response.json(payload, { status: response.status });
    if (response.status === 405 || response.status === 501 || response.status === 503) return Response.json(payload, { status: 503 });
    if (!response.ok) return Response.json({ status: "error", error: `Python Core recomputation returned ${response.status}` }, { status: 502 });
    try {
      const result = normalizeEventRecompute(payload);
      const identityError = verifyRecomputeResponseIdentity(row, result);
      if (identityError) return Response.json({ status: "error", error: identityError }, { status: 502, headers: { "cache-control": "no-store" } });
      return Response.json(result, { headers: { "cache-control": "no-store", "x-bluewolf-investigation": "python-core" } });
    } catch (error) {
      return Response.json({ status: "error", error: error instanceof Error ? error.message : "invalid recomputation payload" }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Python Core recomputation timed out" : "Python Core recomputation is unreachable";
    return Response.json({ status: "unavailable", error: message }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
