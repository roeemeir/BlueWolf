import { recomputeSimulationEvent, simulationEvents } from "@/lib/simulation-investigation";
import { normalizeEventRecompute } from "@/lib/investigation-contract";
import { verifyRecomputeResponseIdentity } from "@/lib/investigation-recompute-identity";
import type { SyncTemplate } from "@/lib/bluewolf";

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ status: "error", error: "request must be valid JSON" }, { status: 400 }); }
  const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (row.source === "simulation") {
    try {
      // Simulation evidence is only valid for a recorded event in the selected
      // server's current archive. The simulator's lower-level fallback can
      // generate QA trajectories for arbitrary ids, which must never be
      // presented by this archive-facing endpoint as an observed event.
      const now = new Date();
      const serverId = Number(row.serverId);
      const eventId = typeof row.eventId === "string" ? row.eventId : "";
      const selectedEvent = simulationEvents(serverId, now).find((event) => event.eventId === eventId);
      if (!selectedEvent) throw new Error("selected simulation event is not present in this server archive");
      if (row.groupId !== undefined && row.groupId !== selectedEvent.groupId) throw new Error("simulation groupId does not match selected event");
      if (row.family !== undefined && row.family !== selectedEvent.family) throw new Error("simulation family does not match selected event");
      const result = normalizeEventRecompute(recomputeSimulationEvent({
        serverId,
        eventId,
        templateId: String(row.templateId ?? ""),
        scenarioId: typeof row.scenarioId === "string" ? row.scenarioId : undefined,
        groupId: selectedEvent.groupId,
        family: selectedEvent.family,
        template: row.template && typeof row.template === "object" && !Array.isArray(row.template) ? row.template as Partial<SyncTemplate> : undefined,
        now,
      }));
      const identityError = verifyRecomputeResponseIdentity(row, result);
      if (identityError) throw new Error(identityError);
      return Response.json(result, { headers: { "cache-control": "no-store", "x-bluewolf-investigation": "simulator-archive" } });
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
