import type { ScoreThresholds, ScoreWeights, SyncTemplate } from "@/lib/bluewolf";
import type {
  AnalysisFrame,
  CoreAnalysis,
  DerivedEvent,
  NavigationDataset as CoreNavigationDataset,
  SoGroupingSettings,
} from "@/packages/bluewolf-core/src/contracts";

export const CORE_API_VERSION = "1.0.0" as const;
export const CORE_IMPLEMENTATION = "python" as const;
export type { AnalysisFrame, CoreAnalysis as NavigationDerivedAnalysis, DerivedEvent };

export type AppCoreOptions = {
  thresholds: ScoreThresholds;
  weights: ScoreWeights;
  siTemplate?: SyncTemplate;
  soTemplate?: SyncTemplate;
  groupingSettings: SoGroupingSettings;
};

type RpcEnvelope = {
  ok?: boolean;
  error?: string;
  message?: string;
  analysis?: CoreAnalysis;
  history?: AnalysisFrame[];
  events?: DerivedEvent[];
};

function coreConfig(options: AppCoreOptions) {
  return {
    thresholds: options.thresholds,
    weights: options.weights,
    siTemplate: options.siTemplate,
    soTemplate: options.soTemplate,
    groupingSettings: options.groupingSettings,
  };
}

async function rpc(payload: Record<string, unknown>): Promise<RpcEnvelope> {
  const response = await fetch("/api/core/rpc", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({ ok: false, message: "Python Core returned invalid JSON" })) as RpcEnvelope;
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || body.error || `Python Core HTTP ${response.status}`);
  }
  return body;
}

/**
 * Single production application/Core boundary.
 *
 * The browser never imports or executes an algorithm implementation. It sends
 * the normalized NavigationDataset + configuration to the same-origin API,
 * which proxies the canonical Python Core service. There is deliberately no
 * TypeScript algorithm fallback: an unavailable Python Core is an explicit
 * integration/no-analysis state.
 */
export async function analyzeNavigationDataset(dataset: CoreNavigationDataset, options: AppCoreOptions): Promise<CoreAnalysis> {
  const body = await rpc({ command: "analyze_dataset", dataset, config: coreConfig(options) });
  if (!body.analysis) throw new Error("Python Core response did not include analysis");
  return body.analysis;
}

export async function analyzeNavigationHistory(
  dataset: CoreNavigationDataset,
  options: AppCoreOptions,
  maxFrames = 61,
  lookbackMinutes = 12,
): Promise<{ history: AnalysisFrame[]; events: DerivedEvent[] }> {
  const body = await rpc({
    command: "analyze_history",
    dataset,
    config: coreConfig(options),
    maxFrames,
    lookbackMinutes,
  });
  if (!body.history || !body.events) throw new Error("Python Core response did not include history/events");
  return { history: body.history, events: body.events };
}

export async function buildAnalysisHistory(dataset: CoreNavigationDataset, options: AppCoreOptions, maxFrames = 61, lookbackMinutes = 12): Promise<AnalysisFrame[]> {
  return (await analyzeNavigationHistory(dataset, options, maxFrames, lookbackMinutes)).history;
}
