import type { InfluxFieldMapping } from "./bluewolf";

export type InfluxMappedRecord = { systemKey: string; time: string; value: string; tags: Record<string, string> };
export type NormalizedInfluxNavigation = { timestamp: string; vehicleId: number; active: boolean; latitude: number; longitude: number; altitude: number | null; velocityNorth: number; velocityEast: number };

function csvRow(line: string) { const out: string[] = []; let current = "", quoted = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; } else if (ch === "," && !quoted) { out.push(current); current = ""; } else current += ch; } out.push(current); return out; }
export function parseInfluxCsv(text: string, systemKey: string): InfluxMappedRecord[] {
  const lines = text.split(/\r?\n/).filter(Boolean); let header: string[] = []; const records: InfluxMappedRecord[] = [];
  for (const line of lines) { if (line.startsWith("#")) continue; const cells = csvRow(line); if (!header.length || cells.includes("_time") && cells.includes("_value")) { header = cells; continue; } if (!header.length || cells.length !== header.length) continue; const row = Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])); if (!row._time) continue; const tags: Record<string, string> = {}; for (const [key, value] of Object.entries(row)) if (value && !key.startsWith("_") && !["result", "table"].includes(key)) tags[key] = value; records.push({ systemKey, time: row._time, value: row._value ?? "", tags }); }
  return records;
}
function mapValue(mapping: InfluxFieldMapping, raw: string) { if (mapping.valueMode !== "special") return raw; const rule = mapping.rules?.find((item) => item.sourceValue === raw) ?? (mapping.sourceValue === raw ? { sourceValue: raw, mappedValue: mapping.mappedValue } : undefined); return rule?.mappedValue ?? mapping.fallbackValue ?? raw; }
function signature(tags: Record<string, string>) { return Object.entries(tags).filter(([key]) => !["_measurement", "_field"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("|"); }
function toNumber(value: unknown) { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : null; }

export function normalizeInfluxRecords(input: { mapping: InfluxFieldMapping; records: InfluxMappedRecord[] }[], joinToleranceSeconds = 2) {
  const tolerance = Math.max(.25, Math.min(30, joinToleranceSeconds)); const buckets = new Map<string, Record<string, unknown> & { time: string; tags: Record<string, string> }>(); const warnings: string[] = [];
  for (const { mapping, records } of input) for (const record of records) { const ms = Date.parse(record.time); if (!Number.isFinite(ms)) continue; const bucketMs = Math.round(ms / (tolerance * 1000)) * tolerance * 1000; const sig = signature(record.tags); const key = `${sig}|${bucketMs}`; const row = buckets.get(key) ?? { time: new Date(bucketMs).toISOString(), tags: record.tags }; row[mapping.systemKey] = mapValue(mapping, record.value); buckets.set(key, row); }
  const rows = [...buckets.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)); const samples: NormalizedInfluxNavigation[] = [];
  for (const row of rows) { const vehicleId = toNumber(row.uniqueVehicleId ?? row.vehicleNumber), latitude = toNumber(row.latitude), longitude = toNumber(row.longitude), velocityNorth = toNumber(row.velocityNorth), velocityEast = toNumber(row.velocityEast), altitude = toNumber(row.altitude); if (vehicleId == null || latitude == null || longitude == null || velocityNorth == null || velocityEast == null) continue; const activeRaw = row.active; const active = activeRaw == null ? true : [true, 1, "1", "true", "green"].includes(activeRaw as never); samples.push({ timestamp: row.time, vehicleId, active, latitude, longitude, altitude, velocityNorth, velocityEast }); }
  if (!samples.length && rows.length) warnings.push("התקבלו רשומות Influx אך לא ניתן היה להרכיב מהן דגימות ניווט מלאות. יש לבדוק זהות רכב, timestamps והמיפויים.");
  if (samples.length && samples.some((sample) => sample.altitude == null)) warnings.push("חלק מדגימות הגובה חסרות; הגובה לא משמש לחישובי הסנכרון/נתיב הנוכחיים.");
  return { samples, warnings };
}
