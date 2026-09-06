const DEFAULT_CORE_URL = "http://127.0.0.1:8765";

type CoreRpcRequest = {
  command?: string;
  dataset?: { provenance?: { source?: string; serverId?: string; sampleCount?: number; latestSampleAt?: string | null } };
};

function coreBaseUrl() {
  const raw = (process.env.BLUEWOLF_PYTHON_CORE_URL ?? DEFAULT_CORE_URL).trim();
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Python Core URL must use http/https");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function commandTimeoutMs(command: unknown) {
  // Historical replay is intentionally heavier than live/current analysis.
  // Keep normal live RPCs bounded tightly while allowing a legitimate history
  // request to finish instead of being misreported as a transport outage.
  if (command === "analyze_history") return 120_000;
  if (command === "restore_analysis_session") return 60_000;
  return 30_000;
}

function ciLiveDiagnostic(command: unknown, body: CoreRpcRequest, payload: unknown) {
  if (!process.env.CI || (command !== "create_analysis_session" && command !== "process_analysis_batch")) return;
  const responseBody = payload as {
    ok?: boolean;
    analysis?: {
      groups?: { si?: { members?: number[] }; so?: { members?: number[] } };
      routes?: Array<{ vehicleId?: number; kind?: string }>;
    };
  };
  const provenance = body.dataset?.provenance;
  const analysis = responseBody.analysis;
  console.info("[bluewolf-live-core]", JSON.stringify({
    command,
    ok: responseBody.ok !== false,
    source: provenance?.source,
    serverId: provenance?.serverId,
    sampleCount: provenance?.sampleCount,
    latestSampleAt: provenance?.latestSampleAt,
    si: analysis?.groups?.si?.members ?? [],
    so: analysis?.groups?.so?.members ?? [],
    routes: analysis?.routes?.map((route) => `${route.vehicleId}:${route.kind}`) ?? [],
  }));
}

export async function GET() {
  try {
    const response = await fetch(`${coreBaseUrl()}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => ({}));
    return Response.json(payload, { status: response.status });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "python_core_unavailable",
      message: error instanceof Error ? error.message : "Python Core unavailable",
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: CoreRpcRequest | null = null;
  try {
    body = await request.json() as CoreRpcRequest;
    const response = await fetch(`${coreBaseUrl()}/rpc`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(commandTimeoutMs(body.command)),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({ ok: false, message: "Invalid Python Core response" }));
    ciLiveDiagnostic(body.command, body, payload);
    return Response.json(payload, { status: response.status });
  } catch (error) {
    if (process.env.CI) {
      const provenance = body?.dataset?.provenance;
      console.error("[bluewolf-core-rpc-error]", JSON.stringify({
        command: body?.command ?? "unknown",
        source: provenance?.source,
        serverId: provenance?.serverId,
        sampleCount: provenance?.sampleCount,
        latestSampleAt: provenance?.latestSampleAt,
        message: error instanceof Error ? error.message : "Python Core unavailable",
      }));
    }
    return Response.json({
      ok: false,
      error: "python_core_unavailable",
      message: error instanceof Error ? error.message : "Python Core unavailable",
    }, { status: 503 });
  }
}
