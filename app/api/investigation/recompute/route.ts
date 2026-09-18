import { recomputeSimulationEvent } from "@/lib/simulation-investigation";
import { normalizeEventRecompute } from "@/lib/investigation-contract";

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
      const result = recomputeSimulationEvent({
        serverId: Number(row.serverId),
        eventId: String(row.eventId ?? ""),
        templateId: String(row.templateId ?? ""),
        scenarioId: typeof row.scenarioId === "string" ? row.scenarioId : undefined,
        groupId: typeof row.groupId === "string" ? row.groupId : undefined,
        family: row.family === "SI" || row.family === "SO" ? row.family : undefined,
        template: row.template && typeof row.template === "object" && !Array.isArray(row.template) ? row.template as Record<string, unknown> : undefined,
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
      return Response.json(normalizeEventRecompute(payload), { headers: { "cache-control": "no-store", "x-bluewolf-investigation": "python-core" } });
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
