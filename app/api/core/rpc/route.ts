const DEFAULT_CORE_URL = "http://127.0.0.1:8765";

function coreBaseUrl() {
  const raw = (process.env.BLUEWOLF_PYTHON_CORE_URL ?? DEFAULT_CORE_URL).trim();
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Python Core URL must use http/https");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export async function GET() {
  try {
    const response = await fetch(`${coreBaseUrl()}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => ({}));
    return Response.json(payload, { status: response.ok ? 200 : 503 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "python_core_unavailable",
      message: error instanceof Error ? error.message : "Python Core unavailable",
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${coreBaseUrl()}/rpc`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({ ok: false, message: "Invalid Python Core response" }));
    return Response.json(payload, { status: response.ok ? 200 : 503 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "python_core_unavailable",
      message: error instanceof Error ? error.message : "Python Core unavailable",
    }, { status: 503 });
  }
}
