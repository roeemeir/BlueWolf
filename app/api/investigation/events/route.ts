import { normalizeInvestigationEvents } from "@/lib/investigation-contract";

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

export async function GET(request: Request) {
  const { baseUrl, token } = runtimeConfig();
  if (!baseUrl) return Response.json({ status: "unavailable", error: "Python Core investigation archive is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const serverId = url.searchParams.get("serverId")?.trim();
  if (!serverId) return Response.json({ status: "error", error: "serverId is required" }, { status: 400 });
  const coreQuery = new URLSearchParams({ serverId });
  for (const name of ["from", "to"] as const) {
    const value = url.searchParams.get(name)?.trim();
    if (value) coreQuery.set(name, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const headers = new Headers({ accept: "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${baseUrl}/v1/investigation/events?${coreQuery.toString()}`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { return Response.json({ status: "error", error: "Python Core investigation archive returned invalid JSON" }, { status: 502 }); }
    if (response.status === 404 || response.status === 405 || response.status === 501) return Response.json({ status: "unavailable", error: "Python Core investigation archive is not available" }, { status: 503 });
    if (response.status === 400) return Response.json(payload, { status: 400 });
    if (response.status === 503) return Response.json(payload, { status: 503 });
    if (!response.ok) return Response.json({ status: "error", error: `Python Core investigation archive returned ${response.status}` }, { status: 502 });
    try {
      return Response.json(normalizeInvestigationEvents(payload), { headers: { "cache-control": "no-store", "x-bluewolf-investigation": "python-core" } });
    } catch (error) {
      return Response.json({ status: "error", error: error instanceof Error ? error.message : "invalid investigation payload" }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Python Core investigation archive timed out" : "Python Core investigation archive is unreachable";
    return Response.json({ status: "unavailable", error: message }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
