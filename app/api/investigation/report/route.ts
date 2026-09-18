import { buildInvestigationPdf, type InvestigationPdfEvent, type InvestigationPdfReport } from "@/lib/investigation-pdf";
import { normalizeEventRecompute, normalizeInvestigationEvents } from "@/lib/investigation-contract";

export const runtime = "nodejs";

function runtimeConfig() {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  return { baseUrl, token };
}

type ReportOverride = {
  eventId: string;
  templateId?: string | null;
  arena?: string | null;
  note?: string | null;
  recomputeRunId?: string | null;
  requiredCodeVersion?: string | null;
  requiredConfigVersion?: string | null;
  requiredTemplateVersion?: string | null;
};
type ReportRequest = { serverId: number; from?: string | null; to?: string | null; overrides?: ReportOverride[]; format: "pdf" | "data" };

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function optionalIso(value: unknown, name: string) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be an ISO-8601 timestamp`);
  const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) throw new Error(`${name} must be an ISO-8601 timestamp`); return parsed.toISOString();
}
function optionalText(value: unknown) { if (value == null) return null; const text = String(value).trim(); return text || null; }

function parseRequest(value: unknown): ReportRequest {
  const row = object(value, "report request");
  if (!Number.isInteger(row.serverId) || Number(row.serverId) < 0) throw new Error("serverId must be a non-negative integer");
  const from = optionalIso(row.from, "from"); const to = optionalIso(row.to, "to");
  if (from && to && from > to) throw new Error("from must not be after to");
  const rawFormat = row.format;
  const format = rawFormat === undefined || rawFormat === null || rawFormat === "" || rawFormat === "pdf" ? "pdf" : rawFormat === "data" ? "data" : null;
  if (!format) throw new Error("format must be pdf or data");
  const rawOverrides = row.overrides ?? [];
  if (!Array.isArray(rawOverrides)) throw new Error("overrides must be an array");
  if (rawOverrides.length > 200) throw new Error("overrides exceeds report event limit");
  const overrides = rawOverrides.map((item, index) => {
    const override = object(item, `override ${index + 1}`);
    const eventId = typeof override.eventId === "string" ? override.eventId.trim() : "";
    if (!eventId) throw new Error("override eventId is required");
    return {
      eventId,
      templateId: optionalText(override.templateId), arena: optionalText(override.arena), note: optionalText(override.note),
      recomputeRunId: optionalText(override.recomputeRunId), requiredCodeVersion: optionalText(override.requiredCodeVersion),
      requiredConfigVersion: optionalText(override.requiredConfigVersion), requiredTemplateVersion: optionalText(override.requiredTemplateVersion),
    };
  });
  if (new Set(overrides.map((item) => item.eventId)).size !== overrides.length) throw new Error("override event ids must be unique");
  return { serverId: Number(row.serverId), from, to, overrides, format };
}

async function coreJson(baseUrl: string, token: string | undefined, path: string, init?: RequestInit, timeoutMs = 90_000) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init?.headers); headers.set("accept", "application/json"); if (init?.body) headers.set("content-type", "application/json"); if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store", signal: controller.signal });
    const text = await response.text(); let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error("Python Core returned invalid JSON"); }
    if (!response.ok) { const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Python Core returned ${response.status}`; const error = new Error(detail) as Error & { status?: number }; error.status = response.status; throw error; }
    return payload;
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("Python Core report request timed out"); throw error; }
  finally { clearTimeout(timeout); }
}

async function recomputeEvent(baseUrl: string, token: string | undefined, eventId: string, templateId: string, generatedAt: string) {
  const payload = await coreJson(baseUrl, token, "/v1/investigation/recompute", { method: "POST", body: JSON.stringify({ eventId, templateId, scenarioId: `pdf-report:${generatedAt}:${eventId}` }) }, 120_000);
  return normalizeEventRecompute(payload);
}
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length); let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (true) { const index = cursor; cursor += 1; if (index >= items.length) return; results[index] = await worker(items[index]); } });
  await Promise.all(runners); return results;
}
function provenanceMismatch(eventId: string, field: string, expected: string, actual: string) {
  const error = new Error(`OP-04 result version mismatch for ${eventId}: ${field} expected ${expected} but runtime returned ${actual}`) as Error & { status?: number };
  error.status = 409; return error;
}

export async function POST(request: Request) {
  const { baseUrl, token } = runtimeConfig();
  if (!baseUrl) return Response.json({ status: "unavailable", error: "Python Core investigation report is not configured" }, { status: 503 });
  let parsed: ReportRequest;
  try { parsed = parseRequest(await request.json()); }
  catch (error) { return Response.json({ status: "error", error: error instanceof Error ? error.message : "invalid report request" }, { status: 400 }); }

  const query = new URLSearchParams({ serverId: String(parsed.serverId) }); if (parsed.from) query.set("from", parsed.from); if (parsed.to) query.set("to", parsed.to);
  try {
    const listing = normalizeInvestigationEvents(await coreJson(baseUrl, token, `/v1/investigation/events?${query.toString()}`, undefined, 45_000));
    if (!listing.events.length) return Response.json({ status: "error", error: "no archived events intersect the requested range" }, { status: 404 });
    if (listing.events.length > 200) return Response.json({ status: "error", error: "report range exceeds 200 events" }, { status: 413 });
    const overrideByEvent = new Map((parsed.overrides ?? []).map((item) => [item.eventId, item]));
    const prepared = listing.events.map((event) => { const override = overrideByEvent.get(event.eventId); const templateId = override?.templateId || event.activeTemplateId; return { event, override, templateId }; });
    const missing = prepared.filter((item) => !item.templateId).map((item) => item.event.eventId);
    if (missing.length) return Response.json({ status: "unavailable", error: "report cannot choose a template without archived or explicit provenance", missingTemplateEvents: missing }, { status: 422 });

    const generatedAt = new Date().toISOString();
    const reportEvents: InvestigationPdfEvent[] = await mapWithConcurrency(prepared, 3, async ({ event, override, templateId }) => {
      const result = await recomputeEvent(baseUrl, token, event.eventId, templateId!, generatedAt);
      if (result.eventId !== event.eventId || result.serverId !== parsed.serverId || result.templateId !== templateId || result.family !== event.family) throw new Error(`recompute provenance mismatch for ${event.eventId}`);
      if (override?.requiredCodeVersion && result.codeVersion !== override.requiredCodeVersion) throw provenanceMismatch(event.eventId, "codeVersion", override.requiredCodeVersion, result.codeVersion);
      if (override?.requiredConfigVersion && result.configVersion !== override.requiredConfigVersion) throw provenanceMismatch(event.eventId, "configVersion", override.requiredConfigVersion, result.configVersion);
      if (override?.requiredTemplateVersion && result.templateVersion !== override.requiredTemplateVersion) throw provenanceMismatch(event.eventId, "templateVersion", override.requiredTemplateVersion, result.templateVersion);
      return { result, arena: override?.arena ?? null, note: override?.note ?? null };
    });
    const codeVersions = new Set(reportEvents.map((item) => item.result.codeVersion)); const configVersions = new Set(reportEvents.map((item) => item.result.configVersion));
    if (codeVersions.size !== 1 || configVersions.size !== 1) return Response.json({ status: "error", error: "report recomputations do not share one code/config version" }, { status: 409 });
    const reportData: InvestigationPdfReport = { serverId: parsed.serverId, from: parsed.from ?? null, to: parsed.to ?? null, generatedAt, events: reportEvents };
    const codeVersion = reportEvents[0].result.codeVersion; const configVersion = reportEvents[0].result.configVersion;
    if (parsed.format === "data") return Response.json({ schemaVersion: "bluewolf.investigation-report-data.v1", source: "core-event-archive", report: reportData, codeVersion, configVersion }, { status: 200, headers: { "cache-control": "no-store", "x-bluewolf-report-source": "core-event-archive", "x-bluewolf-code-version": codeVersion, "x-bluewolf-config-version": configVersion } });
    const pdf = buildInvestigationPdf(reportData); const day = generatedAt.slice(0, 10).replaceAll("-", ""); const pdfBody = new ArrayBuffer(pdf.byteLength); new Uint8Array(pdfBody).set(pdf);
    return new Response(pdfBody, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="bluewolf-investigation-${day}.pdf"`, "cache-control": "no-store", "x-bluewolf-report-source": "core-event-archive", "x-bluewolf-code-version": codeVersion, "x-bluewolf-config-version": configVersion } });
  } catch (error) {
    const status = error instanceof Error && "status" in error && typeof (error as { status?: unknown }).status === "number" ? Number((error as { status: number }).status) : 502;
    const mappedStatus = status === 404 || status === 409 || status === 422 ? status : status === 401 ? 502 : status >= 500 ? 503 : 502;
    return Response.json({ status: "unavailable", error: error instanceof Error ? error.message : "investigation report failed" }, { status: mappedStatus });
  }
}
