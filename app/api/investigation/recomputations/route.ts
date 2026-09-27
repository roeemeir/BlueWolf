import { normalizeEventRecomputeHistory } from "@/lib/investigation-contract";

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId")?.trim() ?? "";
  const source = url.searchParams.get("source")?.trim() ?? "";
  const rawLimit = url.searchParams.get("limit")?.trim() ?? "";
  if (!eventId) return Response.json({ status: "error", error: "eventId is required" }, { status: 400 });
  if (source === "simulation") return Response.json({ status: "unavailable", error: "simulation recompute history is not a durable Core archive" }, { status: 422 });
  if (source && source !== "core") return Response.json({ status: "error", error: "source must be core or simulation" }, { status: 400 });
  const limit = rawLimit ? Number(rawLimit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return Response.json({ status: "error", error: "limit must be an integer in [1,200]" }, { status: 400 });

  const { baseUrl, token } = runtimeConfig();
  if (!baseUrl) return Response.json({ status: "unavailable", error: "Python Core recompute history is not configured" }, { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = new Headers({ accept: "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const endpoint = new URL(`${baseUrl}/v1/investigation/recomputations`);
    endpoint.searchParams.set("eventId", eventId);
    endpoint.searchParams.set("limit", String(limit));
    const response = await fetch(endpoint, { headers, cache: "no-store", signal: controller.signal });
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { return Response.json({ status: "error", error: "Python Core recompute history returned invalid JSON" }, { status: 502 }); }
    if (response.status === 400 || response.status === 404 || response.status === 422) return Response.json(payload, { status: response.status });
    if (response.status === 405 || response.status === 501 || response.status === 503) return Response.json(payload, { status: 503 });
    if (!response.ok) return Response.json({ status: "error", error: `Python Core recompute history returned ${response.status}` }, { status: 502 });
    try {
      const result = normalizeEventRecomputeHistory(payload);
      if (result.eventId !== eventId) return Response.json({ status: "error", error: "Python Core recompute history belongs to another event" }, { status: 502 });
      return Response.json(result, { headers: { "cache-control": "no-store", "x-bluewolf-investigation": "python-core-history" } });
    } catch (error) {
      return Response.json({ status: "error", error: error instanceof Error ? error.message : "invalid recompute history payload" }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Python Core recompute history timed out" : "Python Core recompute history is unreachable";
    return Response.json({ status: "unavailable", error: message }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
