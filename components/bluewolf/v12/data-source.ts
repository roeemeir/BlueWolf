"use client";

import type { InfluxSettings } from "@/lib/bluewolf";
import type { SoGroupingSettings } from "../v10/grouping";
import type { WindMode } from "../v10/wind";
import { generateSimulationDataset, provenanceFromSamples, type NavigationDataset, type RawNavigationSample } from "./navigation-data";

export type DataLoadResult = { dataset: NavigationDataset; error: string | null };

export async function loadNavigationDataset({ mode, serverId, serverTag, from, to, grouping, windMode, influx, targetPoints = 9_000 }: {
  mode: "simulation" | "influx"; serverId: string; serverTag: string; from: Date; to: Date; grouping: SoGroupingSettings; windMode: WindMode; influx: InfluxSettings; targetPoints?: number;
}): Promise<DataLoadResult> {
  if (mode === "simulation") return { dataset: generateSimulationDataset({ serverId, from, to, grouping, windMode, targetPoints }), error: null };
  if (!influx.url || !influx.organization || !influx.token) {
    const warnings = ["מצב Influx נבחר אך פרטי החיבור אינם מלאים. אין fallback לסימולטור."];
    return { dataset: { samples: [], provenance: provenanceFromSamples("influx", serverId, from, to, [], warnings) }, error: warnings[0] };
  }
  try {
    const response = await fetch("/api/influx/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: influx.url, organization: influx.organization, token: influx.token, serverTag, from: from.toISOString(), to: to.toISOString(), joinToleranceSeconds: influx.joinToleranceSeconds, mappings: influx.mappings }) });
    const body = await response.json() as { ok?: boolean; error?: string; samples?: RawNavigationSample[]; warnings?: string[]; diagnostics?: { latestSampleAt?: string | null } };
    if (!response.ok || !body.ok) {
      const message = body.error ?? `Influx query HTTP ${response.status}`; const warnings = [message, ...(body.warnings ?? [])];
      return { dataset: { samples: [], provenance: provenanceFromSamples("influx", serverId, from, to, [], warnings) }, error: message };
    }
    const samples = (body.samples ?? []).map((sample) => ({ ...sample, source: "influx" as const, serverId })); const warnings = body.warnings ?? [];
    return { dataset: { samples, provenance: provenanceFromSamples("influx", serverId, from, to, samples, warnings) }, error: samples.length ? null : "Influx לא החזיר דגימות ניווט מלאות בטווח המבוקש." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Influx query failed";
    return { dataset: { samples: [], provenance: provenanceFromSamples("influx", serverId, from, to, [], [message]) }, error: message };
  }
}
