import { LIVE_RUNTIME_HISTORY_SCHEMA_VERSION, LIVE_RUNTIME_HISTORY_LIMIT } from "@/lib/live-runtime-history";

const serverPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_HISTORY_LIMIT = 5000;

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serverId = url.searchParams.get("serverId") ?? "";
  const rawLimit = url.searchParams.get("limit") ?? String(LIVE_RUNTIME_HISTORY_LIMIT);
  const limit = Number(rawLimit);
  if (!serverPattern.test(serverId)) return Response.json({ error: "valid serverId is required" }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    return Response.json({ error: `limit must be an integer in [1,${MAX_HISTORY_LIMIT}]` }, { status: 400 });
  }

  const { baseUrl, token } = runtimeConfig();
  if (!baseUrl) {
    return Response.json({
      error: "Python Core runtime is not configured in this deployment",
      schemaVersion: LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const headers = new Headers({ accept: "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const upstream = new URL(`${baseUrl}/v1/live-runtime/history`);
    upstream.searchParams.set("serverId", serverId);
    upstream.searchParams.set("limit", String(limit));
    const response = await fetch(upstream, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return Response.json({ error: `Python Core runtime returned ${response.status}` }, { status: 502 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return Response.json({ error: "Python Core runtime returned invalid JSON" }, { status: 502 });
    }
    return Response.json(payload, {
      headers: {
        "cache-control": "no-store",
        "x-bluewolf-runtime": "python-core-history",
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Python Core runtime history timed out"
      : "Python Core runtime history is unreachable";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
