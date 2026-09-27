import { normalizeQaRun, QA_RUN_SCHEMA_VERSION } from "@/lib/qa-contract";

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

export async function POST(request: Request) {
  const { baseUrl, token } = runtimeConfig();
  if (!baseUrl) {
    return Response.json({ status: "unavailable", error: "Python Core QA runner is not configured", schemaVersion: QA_RUN_SCHEMA_VERSION }, { status: 503 });
  }

  let body: unknown = {};
  try { body = await request.json(); } catch { body = {}; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${baseUrl}/v1/qa/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      return Response.json({ status: "unavailable", error: "Python Core QA runner is not available in this runtime", schemaVersion: QA_RUN_SCHEMA_VERSION }, { status: 503 });
    }
    if (!response.ok) return Response.json({ status: "error", error: `Python Core QA runner returned ${response.status}` }, { status: 502 });
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return Response.json({ status: "error", error: "Python Core QA runner returned invalid JSON" }, { status: 502 }); }
    try {
      return Response.json(normalizeQaRun(payload), { headers: { "cache-control": "no-store", "x-bluewolf-qa": "python-core" } });
    } catch (error) {
      return Response.json({ status: "error", error: error instanceof Error ? error.message : "invalid QA payload" }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Python Core QA runner timed out" : "Python Core QA runner is unreachable";
    return Response.json({ status: "unavailable", error: message, schemaVersion: QA_RUN_SCHEMA_VERSION }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
