import type { InfluxFieldMapping } from "./bluewolf";

export type InfluxMappedRecord = { systemKey: string; time: string; value: string; tags: Record<string, string> };
export type NormalizedInfluxNavigation = { timestamp: string; vehicleId: number; active: boolean; latitude: number; longitude: number; altitude: number | null; velocityNorth: number; velocityEast: number };

function csvRow(line: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

type CsvLayout = {
  width: number;
  timeIndex: number;
  valueIndex: number;
  tagColumns: Array<{ index: number; key: string }>;
};

function csvLayout(header: string[]): CsvLayout | null {
  const timeIndex = header.indexOf("_time");
  const valueIndex = header.indexOf("_value");
  if (timeIndex < 0 || valueIndex < 0) return null;
  const tagColumns: CsvLayout["tagColumns"] = [];
  for (let index = 0; index < header.length; index += 1) {
    const key = header[index];
    if (!key || key.startsWith("_") || key === "result" || key === "table") continue;
    tagColumns.push({ index, key });
  }
  return { width: header.length, timeIndex, valueIndex, tagColumns };
}

export function parseInfluxCsv(text: string, systemKey: string): InfluxMappedRecord[] {
  // Influx annotated CSV can repeat a header for every Flux table/series. Build
  // column indices only when such a header is encountered. Data rows then avoid
  // allocating an Object for every CSV column; only `_time`, `_value` and tags
  // required by the Join are materialized.
  const lines = text.split(/\r?\n/);
  let layout: CsvLayout | null = null;
  const records: InfluxMappedRecord[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const cells = csvRow(line);
    const candidateLayout = cells.includes("_time") && cells.includes("_value") ? csvLayout(cells) : null;
    if (candidateLayout) {
      layout = candidateLayout;
      continue;
    }
    if (!layout || cells.length !== layout.width) continue;
    const time = cells[layout.timeIndex] ?? "";
    if (!time) continue;
    const tags: Record<string, string> = {};
    for (const column of layout.tagColumns) {
      const value = cells[column.index] ?? "";
      if (value) tags[column.key] = value;
    }
    records.push({ systemKey, time, value: cells[layout.valueIndex] ?? "", tags });
  }
  return records;
}

function mapValue(mapping: InfluxFieldMapping, raw: string) {
  if (mapping.valueMode !== "special") return raw;
  const rule = mapping.rules?.find((item) => item.sourceValue === raw)
    ?? (mapping.sourceValue === raw ? { sourceValue: raw, mappedValue: mapping.mappedValue } : undefined);
  return rule?.mappedValue ?? mapping.fallbackValue ?? raw;
}

const canonicalSignatureCache = new Map<string, string>();
const MAX_SIGNATURE_CACHE = 4_096;

function signature(tags: Record<string, string>) {
  // CSV column order is stable within one query, so this cheap raw key normally
  // repeats for every sample of the same stream. Canonical sorting is only done
  // on cache miss, while the returned signature remains order-independent across
  // different field/mapping queries.
  const raw = Object.entries(tags).map(([key, value]) => `${key}=${value}`).join("|");
  const cached = canonicalSignatureCache.get(raw);
  if (cached !== undefined) return cached;
  const canonical = Object.entries(tags)
    .filter(([key]) => !["_measurement", "_field"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
  if (canonicalSignatureCache.size >= MAX_SIGNATURE_CACHE) canonicalSignatureCache.clear();
  canonicalSignatureCache.set(raw, canonical);
  return canonical;
}

function toNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeInfluxRecords(
  input: { mapping: InfluxFieldMapping; records: InfluxMappedRecord[] }[],
  joinToleranceSeconds = 5,
) {
  const tolerance = Math.max(.25, Math.min(30, joinToleranceSeconds));
  const buckets = new Map<string, Record<string, unknown> & { time: string; tags: Record<string, string> }>();
  const warnings: string[] = [];

  for (const { mapping, records } of input) {
    for (const record of records) {
      const milliseconds = Date.parse(record.time);
      if (!Number.isFinite(milliseconds)) continue;
      const bucketMs = Math.round(milliseconds / (tolerance * 1000)) * tolerance * 1000;
      const streamSignature = signature(record.tags);
      const key = `${streamSignature}|${bucketMs}`;
      const row = buckets.get(key) ?? { time: new Date(bucketMs).toISOString(), tags: record.tags };
      row[mapping.systemKey] = mapValue(mapping, record.value);
      buckets.set(key, row);
    }
  }

  const rows = [...buckets.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const samples: NormalizedInfluxNavigation[] = [];
  for (const row of rows) {
    const vehicleId = toNumber(row.uniqueVehicleId ?? row.vehicleNumber);
    const latitude = toNumber(row.latitude);
    const longitude = toNumber(row.longitude);
    const velocityNorth = toNumber(row.velocityNorth);
    const velocityEast = toNumber(row.velocityEast);
    const altitude = toNumber(row.altitude);
    if (vehicleId == null || latitude == null || longitude == null || velocityNorth == null || velocityEast == null) continue;
    const activeRaw = row.active;
    const active = activeRaw == null ? true : [true, 1, "1", "true", "green"].includes(activeRaw as never);
    samples.push({ timestamp: row.time, vehicleId, active, latitude, longitude, altitude, velocityNorth, velocityEast });
  }

  if (!samples.length && rows.length) {
    warnings.push("התקבלו רשומות Influx אך לא ניתן היה להרכיב מהן דגימות ניווט מלאות. יש לבדוק זהות רכב, timestamps והמיפויים.");
  }
  if (samples.length && samples.some((sample) => sample.altitude == null)) {
    warnings.push("חלק מדגימות הגובה חסרות; הגובה לא משמש לחישובי הסנכרון/נתיב הנוכחיים.");
  }
  return { samples, warnings };
}
