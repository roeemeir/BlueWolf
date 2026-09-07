import type { InfluxFieldMapping } from "@/lib/bluewolf";
import { normalizeInfluxRecords, parseInfluxCsv } from "@/lib/influx-navigation";

type QueryBody = {
  url?: string;
  organization?: string;
  token?: string;
  serverId?: string;
  from?: string;
  to?: string;
  joinToleranceSeconds?: number;
  targetPoints?: number;
  mappings?: InfluxFieldMapping[];
};

function safeBaseUrl(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https are supported");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function fluxString(value: string) {
  return JSON.stringify(value);
}

/**
 * Historical density budget used before CSV transfer.
 *
 * The application target is expressed as total joined NAV points. Vehicle
 * count is not known until after the query, so use the same conservative
 * eight-vehicle planning factor as the deterministic simulator. Short/live
 * windows remain raw. For ranges up to 24 hours, never reduce below one real
 * sample per ten seconds: that preserves enough temporal evidence for route
 * topology, 120-second membership changes and the 10-second alert lifecycle.
 * Long history is reduced inside Influx with `last`, never averaged into a
 * synthetic route point.
 */
function aggregateEverySeconds(from: Date, to: Date, targetPoints: number) {
  const durationSeconds = Math.max(1, (to.getTime() - from.getTime()) / 1000);
  const target = Math.max(1_000, Math.min(100_000, Math.round(targetPoints)));
  const planned = Math.ceil(durationSeconds * 8 / target);
  if (durationSeconds <= 20 * 60) return 1;
  if (durationSeconds <= 24 * 60 * 60) return Math.max(1, Math.min(10, planned));
  return Math.max(1, planned);
}

async function queryMapping(
  baseUrl: string,
  organization: string,
  token: string,
  serverId: string,
  from: string,
  to: string,
  mapping: InfluxFieldMapping,
  aggregateSeconds: number,
) {
  const serverFilter = serverId
    ? `\n  |> filter(fn: (r) => exists r.server_id and string(v: r.server_id) == ${fluxString(serverId)})`
    : "";
  const aggregate = aggregateSeconds > 1
    ? `\n  |> aggregateWindow(every: ${aggregateSeconds}s, fn: last, createEmpty: false)`
    : "";
  const query = `from(bucket: ${fluxString(mapping.bucket)})\n  |> range(start: time(v: ${fluxString(from)}), stop: time(v: ${fluxString(to)}))\n  |> filter(fn: (r) => r._measurement == ${fluxString(mapping.measurement)})\n  |> filter(fn: (r) => r._field == ${fluxString(mapping.key)})${serverFilter}${aggregate}\n  |> sort(columns: ["_time"])`;
  const response = await fetch(`${baseUrl}/api/v2/query?org=${encodeURIComponent(organization)}`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Token ${token}`, accept: "text/csv", "content-type": "application/vnd.flux" },
    body: query,
  });
  if (!response.ok) throw new Error(`${mapping.systemKey}: Influx query HTTP ${response.status}`);
  return parseInfluxCsv(await response.text(), mapping.systemKey);
}

export async function POST(request: Request) {
  const totalStarted = Date.now();
  try {
    const body = await request.json() as QueryBody;
    const baseUrl = safeBaseUrl((body.url ?? "").trim());
    const organization = (body.organization ?? "").trim();
    const token = (body.token ?? "").trim();
    const serverId = (body.serverId ?? "").trim();
    const from = new Date(body.from ?? "");
    const to = new Date(body.to ?? "");
    if (!organization || !token) throw new Error("Influx organization/token are required");
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new Error("Invalid time range");

    const mappings = (body.mappings ?? []).filter((item) => item.bucket && item.measurement && item.key);
    const required = ["uniqueVehicleId", "latitude", "longitude", "velocityNorth", "velocityEast"];
    const missing = required.filter((key) => !mappings.some((item) => item.systemKey === key));
    if (missing.length) return Response.json({ ok: false, error: `Missing required mappings: ${missing.join(", ")}`, samples: [], warnings: [] }, { status: 400 });

    const aggregateSeconds = aggregateEverySeconds(from, to, body.targetPoints ?? 9_000);
    const queryStarted = Date.now();
    const queried = await Promise.all(mappings.map(async (mapping) => ({
      mapping,
      records: await queryMapping(baseUrl, organization, token, serverId, from.toISOString(), to.toISOString(), mapping, aggregateSeconds),
    })));
    const queryMs = Date.now() - queryStarted;
    const queriedRecordCount = queried.reduce((sum, item) => sum + item.records.length, 0);

    const joinStarted = Date.now();
    const normalized = normalizeInfluxRecords(queried, body.joinToleranceSeconds ?? 5);
    const joinMs = Date.now() - joinStarted;
    const candidates = normalized.samples;
    const origin = candidates[0] ? { lat: candidates[0].latitude, lon: candidates[0].longitude } : { lat: 0, lon: 0 };
    const metresLat = 111_320;
    const metresLon = metresLat * Math.cos(origin.lat * Math.PI / 180);
    const samples = candidates.map((item) => ({
      source: "influx",
      serverId,
      timestamp: item.timestamp,
      vehicleId: item.vehicleId,
      active: item.active,
      latitude: item.latitude,
      longitude: item.longitude,
      altitude: item.altitude ?? null,
      velocityNorth: item.velocityNorth,
      velocityEast: item.velocityEast,
      x: (item.longitude - origin.lon) * metresLon,
      y: (item.latitude - origin.lat) * metresLat,
    }));
    const vehicleCount = new Set(samples.map((item) => item.vehicleId)).size;
    const latestSampleAt = samples.at(-1)?.timestamp ?? null;
    return Response.json({
      ok: true,
      samples,
      diagnostics: {
        sourceHost: new URL(baseUrl).host,
        serverId,
        from: from.toISOString(),
        to: to.toISOString(),
        aggregateEverySeconds: aggregateSeconds,
        targetPoints: body.targetPoints ?? 9_000,
        queriedRecordCount,
        normalizedSampleCount: samples.length,
        vehicleCount,
        latestSampleAt,
        queryMs,
        joinMs,
        totalMs: Date.now() - totalStarted,
        warningCount: normalized.warnings.length,
      },
      warnings: normalized.warnings,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Influx query failed", samples: [], warnings: [] }, { status: 400 });
  }
}
