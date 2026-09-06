import type { InfluxFieldMapping } from "@/lib/bluewolf";

type QueryBody = {
  url?: string; organization?: string; token?: string; serverTag?: string; from?: string; to?: string; joinToleranceSeconds?: number; mappings?: InfluxFieldMapping[];
};
type RawRecord = { systemKey: string; time: string; value: string; tags: Record<string, string> };

function safeBaseUrl(value: string) { const parsed = new URL(value); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https are supported"); parsed.pathname = parsed.pathname.replace(/\/$/, ""); parsed.search = ""; parsed.hash = ""; return parsed.toString().replace(/\/$/, ""); }
function fluxString(value: string) { return JSON.stringify(value); }
function csvRow(line: string) { const out: string[] = []; let current = "", quoted = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; } else if (ch === "," && !quoted) { out.push(current); current = ""; } else current += ch; } out.push(current); return out; }
function parseInfluxCsv(text: string, systemKey: string): RawRecord[] {
  const lines = text.split(/\r?\n/).filter(Boolean); let header: string[] = []; const records: RawRecord[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue; const cells = csvRow(line);
    if (!header.length || cells.includes("_time") && cells.includes("_value")) { header = cells; continue; }
    if (!header.length || cells.length !== header.length) continue;
    const row = Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])); if (!row._time) continue;
    const tags: Record<string, string> = {}; for (const [key, value] of Object.entries(row)) if (value && !key.startsWith("_") && !["result", "table"].includes(key)) tags[key] = value;
    records.push({ systemKey, time: row._time, value: row._value ?? "", tags });
  }
  return records;
}

function mapValue(mapping: InfluxFieldMapping, raw: string) {
  if (mapping.valueMode !== "special") return raw;
  const rule = mapping.rules?.find((item) => item.sourceValue === raw) ?? (mapping.sourceValue === raw ? { sourceValue: raw, mappedValue: mapping.mappedValue } : undefined);
  return rule?.mappedValue ?? mapping.fallbackValue ?? raw;
}
function signature(tags: Record<string, string>) { return Object.entries(tags).filter(([key]) => !["_measurement", "_field"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("|"); }
function toNumber(value: unknown) { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : null; }

async function queryMapping(baseUrl: string, organization: string, token: string, serverTag: string, from: string, to: string, mapping: InfluxFieldMapping) {
  const query = `from(bucket: ${fluxString(mapping.bucket)})\n  |> range(start: time(v: ${fluxString(from)}), stop: time(v: ${fluxString(to)}))\n  |> filter(fn: (r) => r._measurement == ${fluxString(mapping.measurement)})\n  |> filter(fn: (r) => r._field == ${fluxString(mapping.key)})${serverTag ? `\n  |> filter(fn: (r) => if exists r.server then r.server == ${fluxString(serverTag)} else if exists r.ttag then r.ttag == ${fluxString(serverTag)} else true)` : ""}\n  |> sort(columns: ["_time"])`;
  const response = await fetch(`${baseUrl}/api/v2/query?org=${encodeURIComponent(organization)}`, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { authorization: `Token ${token}`, accept: "text/csv", "content-type": "application/vnd.flux" }, body: query });
  if (!response.ok) throw new Error(`${mapping.systemKey}: Influx query HTTP ${response.status}`); return parseInfluxCsv(await response.text(), mapping.systemKey);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as QueryBody; const baseUrl = safeBaseUrl((body.url ?? "").trim()); const organization = (body.organization ?? "").trim(); const token = (body.token ?? "").trim();
    const from = new Date(body.from ?? ""); const to = new Date(body.to ?? ""); if (!organization || !token) throw new Error("Influx organization/token are required"); if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new Error("Invalid time range");
    const mappings = (body.mappings ?? []).filter((item) => item.bucket && item.measurement && item.key); const required = ["uniqueVehicleId", "latitude", "longitude", "velocityNorth", "velocityEast"]; const missing = required.filter((key) => !mappings.some((item) => item.systemKey === key)); if (missing.length) return Response.json({ ok: false, error: `Missing required mappings: ${missing.join(", ")}`, samples: [], warnings: [] }, { status: 400 });
    const results = await Promise.all(mappings.map(async (mapping) => ({ mapping, records: await queryMapping(baseUrl, organization, token, body.serverTag ?? "", from.toISOString(), to.toISOString(), mapping) })));
    const tolerance = Math.max(.25, Math.min(30, body.joinToleranceSeconds ?? 2)); const buckets = new Map<string, Record<string, unknown> & { time: string; tags: Record<string, string> }>(); const warnings: string[] = [];
    for (const { mapping, records } of results) for (const record of records) {
      const ms = Date.parse(record.time); if (!Number.isFinite(ms)) continue; const bucketMs = Math.round(ms / (tolerance * 1000)) * tolerance * 1000; const sig = signature(record.tags); const key = `${sig}|${bucketMs}`; const row = buckets.get(key) ?? { time: new Date(bucketMs).toISOString(), tags: record.tags };
      row[mapping.systemKey] = mapValue(mapping, record.value); buckets.set(key, row);
    }
    const joined = [...buckets.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)); const candidates = joined.map((row) => {
      const vehicleId = toNumber(row.uniqueVehicleId ?? row.vehicleNumber); const latitude = toNumber(row.latitude), longitude = toNumber(row.longitude), velocityNorth = toNumber(row.velocityNorth), velocityEast = toNumber(row.velocityEast), altitude = toNumber(row.altitude);
      const activeRaw = row.active; const active = activeRaw == null ? true : [true, 1, "1", "true", "green"].includes(activeRaw as never);
      return vehicleId != null && latitude != null && longitude != null && velocityNorth != null && velocityEast != null ? { time: row.time, vehicleId, latitude, longitude, velocityNorth, velocityEast, altitude, active } : null;
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!candidates.length) warnings.push("Influx returned records but none could be normalized into complete navigation samples. Check vehicle/time identity and mappings.");
    const origin = candidates[0] ? { lat: candidates[0].latitude, lon: candidates[0].longitude } : { lat: 0, lon: 0 }; const metresLat = 111_320, metresLon = metresLat * Math.cos(origin.lat * Math.PI / 180);
    const samples = candidates.map((item) => ({ source: "influx", serverId: body.serverTag ?? "", timestamp: item.time, vehicleId: item.vehicleId, active: item.active, latitude: item.latitude, longitude: item.longitude, altitude: item.altitude, velocityNorth: item.velocityNorth, velocityEast: item.velocityEast, x: (item.longitude - origin.lon) * metresLon, y: (item.latitude - origin.lat) * metresLat }));
    const vehicleCount = new Set(samples.map((item) => item.vehicleId)).size; const latestSampleAt = samples.at(-1)?.timestamp ?? null;
    return Response.json({ ok: true, samples, diagnostics: { sourceHost: new URL(baseUrl).host, from: from.toISOString(), to: to.toISOString(), normalizedSampleCount: samples.length, vehicleCount, latestSampleAt, warningCount: warnings.length }, warnings });
  } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "Influx query failed", samples: [], warnings: [] }, { status: 400 }); }
}
