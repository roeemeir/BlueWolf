"use client";

import type { InfluxSettings } from "@/lib/bluewolf";
import type { SoGroupingSettings } from "../v10/grouping";
import type { WindMode } from "../v10/wind";
import { generateSimulationDataset, provenanceFromSamples, type NavigationDataset, type RawNavigationSample } from "./navigation-data";

export type DataLoadResult = { dataset: NavigationDataset; error: string | null };

const CORE_ROUTE_EVIDENCE_MINUTES = 40;
const LIVE_MIN_VISIBLE_MINUTES = 20;

function evidenceWindow(from: Date, to: Date) {
  const visibleMs = Math.max(0, to.getTime() - from.getTime());
  const visibleMinutes = visibleMs / 60_000;
  if (visibleMinutes < LIVE_MIN_VISIBLE_MINUTES || visibleMinutes >= CORE_ROUTE_EVIDENCE_MINUTES) {
    return { from, targetScale: 1, extended: false };
  }
  const coreFrom = new Date(to.getTime() - CORE_ROUTE_EVIDENCE_MINUTES * 60_000);
  return {
    from: coreFrom,
    targetScale: Math.max(1, (to.getTime() - coreFrom.getTime()) / Math.max(1, visibleMs)),
    extended: true,
  };
}

function visibleDataset(source: "simulation" | "influx", serverId: string, from: Date, to: Date, evidence: NavigationDataset, warnings: string[]): NavigationDataset {
  const samples = evidence.samples.filter((sample) => {
    const timestamp = Date.parse(sample.timestamp);
    return timestamp >= from.getTime() && timestamp <= to.getTime();
  });
  return {
    samples,
    provenance: provenanceFromSamples(source, serverId, from, to, samples, warnings),
    coreEvidenceSamples: evidence.samples,
    coreEvidenceProvenance: evidence.provenance,
  };
}

/**
 * Load one navigation source. Real Influx server selection uses the canonical
 * server_id identity. Historical callers may still carry a legacy serverTag
 * property while persisted workspaces migrate; it is deliberately ignored.
 *
 * For live windows shorter than the 40-minute Core route-history horizon, the
 * source is queried once from T-40m. Only the requested visible window is put in
 * `dataset.samples`; the extra evidence is carried separately for Python Core.
 * Historical ranges >=40m are not expanded.
 */
export async function loadNavigationDataset({ mode, serverId, from, to, grouping, windMode, influx, targetPoints = 9_000 }: {
  mode: "simulation" | "influx"; serverId: string; serverTag?: string; from: Date; to: Date; grouping: SoGroupingSettings; windMode: WindMode; influx: InfluxSettings; targetPoints?: number;
}): Promise<DataLoadResult> {
  const evidence = evidenceWindow(from, to);
  const evidenceTarget = Math.max(1_000, Math.min(50_000, Math.round(targetPoints * evidence.targetScale)));

  if (mode === "simulation") {
    const full = generateSimulationDataset({ serverId, from: evidence.from, to, grouping, windMode, targetPoints: evidenceTarget });
    return {
      dataset: evidence.extended ? visibleDataset("simulation", serverId, from, to, full, full.provenance.warnings) : full,
      error: null,
    };
  }
  if (!influx.url || !influx.organization || !influx.token) {
    const warnings = ["מצב Influx נבחר אך פרטי החיבור אינם מלאים. אין fallback לסימולטור."];
    return { dataset: { samples: [], provenance: provenanceFromSamples("influx", serverId, from, to, [], warnings) }, error: warnings[0] };
  }
  try {
    const response = await fetch("/api/influx/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: influx.url,
        organization: influx.organization,
        token: influx.token,
        serverId,
        from: evidence.from.toISOString(),
        to: to.toISOString(),
        joinToleranceSeconds: influx.joinToleranceSeconds,
        targetPoints: evidenceTarget,
        mappings: influx.mappings,
      }),
    });
    const body = await response.json() as { ok?: boolean; error?: string; samples?: RawNavigationSample[]; warnings?: string[]; diagnostics?: { latestSampleAt?: string | null } };
    if (!response.ok || !body.ok) {
      const message = body.error ?? `Influx query HTTP ${response.status}`;
      const warnings = [message, ...(body.warnings ?? [])];
      return { dataset: { samples: [], provenance: provenanceFromSamples("influx", serverId, from, to, [], warnings) }, error: message };
    }
    const samples = (body.samples ?? []).map((sample) => ({ ...sample, source: "influx" as const, serverId }));
    const warnings = body.warnings ?? [];
    const full: NavigationDataset = {
      samples,
      provenance: provenanceFromSamples("influx", serverId, evidence.from, to, samples, warnings),
    };
    const dataset = evidence.extended ? visibleDataset("influx", serverId, from, to, full, warnings) : full;
    return {
      dataset,
      error: dataset.samples.length ? null : "Influx לא החזיר דגימות ניווט מלאות בטווח המבוקש.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Influx query failed";
    return { dataset: { samples: [], provenance: provenanceFromSamples("influx", serverId, from, to, [], [message]) }, error: message };
  }
}
