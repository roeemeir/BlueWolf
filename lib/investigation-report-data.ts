import { normalizeEventRecompute } from "@/lib/investigation-contract";
import type { InvestigationPdfReport } from "@/lib/investigation-pdf";

export const INVESTIGATION_REPORT_DATA_SCHEMA = "bluewolf.investigation-report-data.v1" as const;
export const INVESTIGATION_REPORT_SOURCE = "core-event-archive" as const;
export const SIMULATION_REPORT_SOURCE = "simulator-archive" as const;
export type InvestigationReportSource = typeof INVESTIGATION_REPORT_SOURCE | typeof SIMULATION_REPORT_SOURCE;

export type InvestigationReportEvent = InvestigationPdfReport["events"][number] & {
  arena: string | null;
  note: string | null;
};

export type NormalizedInvestigationReport = Omit<InvestigationPdfReport, "events"> & {
  events: InvestigationReportEvent[];
};

export type InvestigationReportDataEnvelope = {
  schemaVersion: typeof INVESTIGATION_REPORT_DATA_SCHEMA;
  source: InvestigationReportSource;
  report: NormalizedInvestigationReport;
  codeVersion: string;
  configVersion: string;
};

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is missing`);
  return value;
}

function nullableText(value: unknown, name: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${name} must be a string or null`);
  return value;
}

function isoOrNull(value: unknown, name: string) {
  if (value === null || value === undefined) return null;
  const result = text(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} must be ISO-8601`);
  return result;
}

export function normalizeInvestigationReportData(value: unknown): InvestigationReportDataEnvelope {
  const row = object(value, "report data envelope");
  if (row.schemaVersion !== INVESTIGATION_REPORT_DATA_SCHEMA) throw new Error("unsupported report data schema");
  if (row.source !== INVESTIGATION_REPORT_SOURCE && row.source !== SIMULATION_REPORT_SOURCE) throw new Error("report source is not a supported investigation archive");
  const codeVersion = text(row.codeVersion, "codeVersion");
  const configVersion = text(row.configVersion, "configVersion");
  const reportRow = object(row.report, "report");
  if (!Number.isInteger(reportRow.serverId) || Number(reportRow.serverId) < 0) throw new Error("report serverId must be a non-negative integer");
  const serverId = Number(reportRow.serverId);
  const from = isoOrNull(reportRow.from, "report from");
  const to = isoOrNull(reportRow.to, "report to");
  if (from && to && from > to) throw new Error("report from must not be after to");
  const generatedAt = text(reportRow.generatedAt, "report generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("report generatedAt must be ISO-8601");
  if (!Array.isArray(reportRow.events) || reportRow.events.length === 0) throw new Error("report events must be a non-empty array");
  if (reportRow.events.length > 200) throw new Error("report event limit exceeded");
  const events: InvestigationReportEvent[] = reportRow.events.map((raw, index) => {
    const event = object(raw, `report event ${index + 1}`);
    const result = normalizeEventRecompute(event.result);
    if (result.serverId !== serverId) throw new Error("report event belongs to a different server");
    if (result.codeVersion !== codeVersion) throw new Error("report code version mismatch");
    if (result.configVersion !== configVersion) throw new Error("report config version mismatch");
    return {
      result,
      arena: nullableText(event.arena, "event arena"),
      note: nullableText(event.note, "event note"),
    };
  });
  const source = row.source as InvestigationReportSource;
  return {
    schemaVersion: INVESTIGATION_REPORT_DATA_SCHEMA,
    source,
    codeVersion,
    configVersion,
    report: { source, serverId, from, to, generatedAt, events },
  };
}
