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

async function queryMapping(
  baseUrl: string,
  organization: string,
  token: string,
  serverId: string,
  from: string,
  to: string,
  mapping: InfluxFieldMapping,
) {
  const serverFilter = serverId
    ? `\n  |> filter(fn: (r) => exists r.server_id and string(v: r.server_id) == ${fluxString(serverId)})`
    : "";
  const query = `from(bucket: ${fluxString(mapping.bucket)})\n  |> range(start: time(v: ${fluxString(from)}), stop: time(v: ${fluxString(to)}))\n  |> filter(fn: (r) => r._measurement == ${fluxString(mapping.measurement)})\n  |> filter(fn: (r) => r._field == ${fluxString(mapping.key)})${serverFilter}\n  |> sort(columns: ["_time"])`;
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

    const queried = await Promise.all(mappings.map(async (mapping) => ({
      mapping,
      records: await queryMapping(baseUrl, organization, token, serverId, from.toISOString(), to.toISOString(), mapping),
    })));
    const normalized = normalizeInfluxRecords(queried, body.joinToleranceSeconds ?? 5);
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
        normalizedSampleCount: samples.length,
        vehicleCount,
        latestSampleAt,
        warningCount: normalized.warnings.length,
      },
      warnings: normalized.warnings,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Influx query failed", samples: [], warnings: [] }, { status: 400 });
  }
}
