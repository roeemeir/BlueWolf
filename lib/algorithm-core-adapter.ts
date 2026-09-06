import type { ScoreThresholds, ScoreWeights, SyncTemplate } from "@/lib/bluewolf";
import type {
  AnalysisFrame,
  CoreAnalysis,
  DerivedEvent,
  NavigationDataset as CoreNavigationDataset,
  SoGeometryDescriptor,
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
  /** Optional explicit role; normal Operator sessions are promoted by the live History request. */
  liveRole?: "primary" | "preview";
};

export type SoGroupingEvidence = {
  valid: boolean;
  angleDiffDeg: number;
  parallelDistance: number;
  lateralDistance: number;
  meanLeg: number;
  parallelLegs: number;
  lateralLegs: number;
  axisDeg: number;
  explanation: string;
};

type RpcEnvelope = {
  ok?: boolean;
  error?: string;
  message?: string;
  sessionId?: string;
  analysis?: CoreAnalysis;
  history?: AnalysisFrame[];
  events?: DerivedEvent[];
  evidence?: SoGroupingEvidence;
  acceptedSamples?: number;
  coreBatchResult?: unknown;
  checkpointBase64?: string;
  processedUntilUtc?: string | null;
  recoveryHistoryStartUtc?: string | null;
};

type LiveEnvelope = {
  analysis: CoreAnalysis;
  history: AnalysisFrame[];
  events: DerivedEvent[];
  acceptedSamples: number;
};

type LiveSessionEntry = {
  sessionId: string;
  latestMs: number;
  windowSpanMs: number;
  envelope: LiveEnvelope;
  touchedAt: number;
  lastCheckpointAt: number;
};

type PendingLive = {
  latestMs: number;
  promise: Promise<LiveEnvelope>;
};

type StoredCheckpoint = {
  available?: boolean;
  checkpointBase64?: string;
  processedUntilUtc?: string;
  coreApiVersion?: string;
  algorithmVersion?: string;
};

const liveSessions = new Map<string, LiveSessionEntry>();
const livePending = new Map<string, PendingLive>();
const operationalLiveKeys = new Set<string>();
const LIVE_MIN_WINDOW_MS = 20 * 60_000;
const LIVE_MAX_WINDOW_MS = 2 * 60 * 60_000 + 5_000;
const LIVE_SESSION_LIMIT = 12;
const CHECKPOINT_INTERVAL_MS = 5 * 60_000;

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

function datasetTimes(dataset: CoreNavigationDataset) {
  const fromMs = Date.parse(dataset.provenance.from);
  const toMs = Date.parse(dataset.provenance.to);
  const sampleLatestMs = dataset.samples.reduce((latest, sample) => Math.max(latest, Date.parse(sample.timestamp) || 0), 0);
  const provenanceLatestMs = dataset.provenance.latestSampleAt ? Date.parse(dataset.provenance.latestSampleAt) : 0;
  const latestMs = Math.max(sampleLatestMs, provenanceLatestMs || 0);
  return {
    fromMs,
    toMs,
    latestMs,
    spanMs: Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.max(0, toMs - fromMs) : 0,
  };
}

function stableConfigKey(options: AppCoreOptions) {
  const raw = JSON.stringify(coreConfig(options));
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function liveSessionKey(dataset: CoreNavigationDataset, options: AppCoreOptions) {
  const { spanMs } = datasetTimes(dataset);
  const windowSeconds = Math.round(spanMs / 1000);
  return `${dataset.provenance.source}:${dataset.provenance.serverId}:${windowSeconds}:${stableConfigKey(options)}`;
}

function isLiveWindow(dataset: CoreNavigationDataset) {
  const { spanMs, latestMs } = datasetTimes(dataset);
  return latestMs > 0 && spanMs >= LIVE_MIN_WINDOW_MS && spanMs <= LIVE_MAX_WINDOW_MS;
}

function requireLiveEnvelope(body: RpcEnvelope): LiveEnvelope {
  if (!body.analysis || !body.history || !body.events) {
    throw new Error("Python Core live response did not include analysis/history/events");
  }
  return {
    analysis: body.analysis,
    history: body.history,
    events: body.events,
    acceptedSamples: body.acceptedSamples ?? 0,
  };
}

function deltaDataset(dataset: CoreNavigationDataset, afterMs: number): CoreNavigationDataset {
  const samples = dataset.samples.filter((sample) => Date.parse(sample.timestamp) > afterMs);
  const first = samples[0]?.timestamp ?? dataset.provenance.to;
  const vehicles = new Set(samples.map((sample) => sample.vehicleId));
  return {
    samples,
    provenance: {
      ...dataset.provenance,
      from: first,
      sampleCount: samples.length,
      vehicleCount: vehicles.size,
      latestSampleAt: samples.at(-1)?.timestamp ?? dataset.provenance.latestSampleAt,
    },
  };
}

function workspaceId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("bluewolf-workspace-id");
}

async function loadStoredCheckpoint(dataset: CoreNavigationDataset): Promise<StoredCheckpoint | null> {
  if (dataset.provenance.source !== "influx") return null;
  const id = workspaceId();
  if (!id) return null;
  try {
    const response = await fetch(`/api/core/checkpoint?serverId=${encodeURIComponent(dataset.provenance.serverId)}`, {
      cache: "no-store",
      headers: { "x-bluewolf-workspace": id },
    });
    if (!response.ok) return null;
    const body = await response.json() as StoredCheckpoint;
    return body.available && body.checkpointBase64 ? body : null;
  } catch {
    return null;
  }
}

async function saveStoredCheckpoint(dataset: CoreNavigationDataset, entry: LiveSessionEntry) {
  if (dataset.provenance.source !== "influx") return;
  const id = workspaceId();
  if (!id) return;
  try {
    const snapshot = await rpc({ command: "checkpoint_analysis_session", sessionId: entry.sessionId });
    if (!snapshot.checkpointBase64 || !snapshot.processedUntilUtc) return;
    await fetch("/api/core/checkpoint", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bluewolf-workspace": id },
      body: JSON.stringify({
        serverId: dataset.provenance.serverId,
        coreApiVersion: CORE_API_VERSION,
        algorithmVersion: "python-current",
        processedUntilUtc: snapshot.processedUntilUtc,
        checkpointBase64: snapshot.checkpointBase64,
      }),
    });
  } catch {
    // Persistence failure does not change the already-computed Core result.
  }
}

async function closeLiveSession(entry: LiveSessionEntry | undefined) {
  if (!entry?.sessionId) return;
  try {
    await rpc({ command: "close_analysis_session", sessionId: entry.sessionId });
  } catch {
    // Session cleanup is best-effort; failure must never trigger an algorithm fallback.
  }
}

function trimLiveSessions() {
  if (liveSessions.size <= LIVE_SESSION_LIMIT) return;
  const oldest = [...liveSessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
  if (!oldest) return;
  liveSessions.delete(oldest[0]);
  operationalLiveKeys.delete(oldest[0]);
  void closeLiveSession(oldest[1]);
}

function isOperationalLiveKey(key: string, options: AppCoreOptions) {
  if (options.liveRole === "preview") return false;
  return options.liveRole === "primary" || operationalLiveKeys.has(key);
}

async function startLiveSession(dataset: CoreNavigationDataset, options: AppCoreOptions, spanMs: number, key: string) {
  // Yield once so Operator's sibling History request can promote this key before
  // checkpoint restore is decided. Template preview calls do not request History.
  await Promise.resolve();
  const config = coreConfig(options);
  const stored = isOperationalLiveKey(key, options) ? await loadStoredCheckpoint(dataset) : null;
  const { fromMs, latestMs } = datasetTimes(dataset);
  const checkpointMs = stored?.processedUntilUtc ? Date.parse(stored.processedUntilUtc) : Number.NaN;
  const canRestore = Boolean(
    stored?.checkpointBase64 &&
    stored.coreApiVersion === CORE_API_VERSION &&
    Number.isFinite(checkpointMs) &&
    checkpointMs >= fromMs &&
    checkpointMs <= latestMs,
  );

  if (canRestore) {
    try {
      return await rpc({
        command: "restore_analysis_session",
        checkpointBase64: stored!.checkpointBase64,
        config,
        recoveryDataset: dataset,
        retentionSeconds: Math.max(12 * 60, Math.ceil(spanMs / 1000)),
        maxHistoryFrames: 72,
      });
    } catch {
      // Incompatible/stale checkpoint falls back to a clean Python warm-up,
      // never to the TypeScript compatibility algorithm.
    }
  }

  return rpc({
    command: "create_analysis_session",
    config,
    dataset,
    retentionSeconds: Math.max(12 * 60, Math.ceil(spanMs / 1000)),
    maxHistoryFrames: 72,
  });
}

async function ensureLiveEnvelope(dataset: CoreNavigationDataset, options: AppCoreOptions, operationalRequest = false): Promise<LiveEnvelope> {
  const key = liveSessionKey(dataset, options);
  if (operationalRequest && options.liveRole !== "preview") operationalLiveKeys.add(key);
  const { latestMs, spanMs } = datasetTimes(dataset);
  const pending = livePending.get(key);
  if (pending && pending.latestMs === latestMs) return pending.promise;

  const promise = (async () => {
    let entry = liveSessions.get(key);
    const movedBackwards = entry ? latestMs < entry.latestMs : false;
    if (movedBackwards) {
      liveSessions.delete(key);
      await closeLiveSession(entry);
      entry = undefined;
    }

    if (!entry) {
      const body = await startLiveSession(dataset, options, spanMs, key);
      if (!body.sessionId) throw new Error("Python Core did not return live sessionId");
      const envelope = requireLiveEnvelope(body);
      const created: LiveSessionEntry = {
        sessionId: body.sessionId,
        latestMs,
        windowSpanMs: spanMs,
        envelope,
        touchedAt: Date.now(),
        lastCheckpointAt: Date.now(),
      };
      liveSessions.set(key, created);
      trimLiveSessions();
      return envelope;
    }

    if (latestMs <= entry.latestMs) {
      entry.touchedAt = Date.now();
      return entry.envelope;
    }

    const delta = deltaDataset(dataset, entry.latestMs);
    const body = await rpc({
      command: "process_analysis_batch",
      sessionId: entry.sessionId,
      dataset: delta,
    });
    const envelope = requireLiveEnvelope(body);
    const now = Date.now();
    const updated: LiveSessionEntry = {
      ...entry,
      latestMs,
      windowSpanMs: spanMs,
      envelope,
      touchedAt: now,
    };
    liveSessions.set(key, updated);
    if (isOperationalLiveKey(key, options) && dataset.provenance.source === "influx" && now - updated.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
      updated.lastCheckpointAt = now;
      await saveStoredCheckpoint(dataset, updated);
    }
    return envelope;
  })();

  livePending.set(key, { latestMs, promise });
  try {
    return await promise;
  } finally {
    const current = livePending.get(key);
    if (current?.promise === promise) livePending.delete(key);
  }
}

/**
 * Single production application/Core boundary.
 *
 * Live operator windows are warmed once in a stateful Python Core session and
 * then send only samples newer than the previous five-second poll. A live key
 * becomes operational only when the Operator History/Timeline request promotes
 * it; therefore template-only preview sessions cannot restore or overwrite the
 * five-minute Influx checkpoint. Historical investigation and short E2E fixtures
 * remain stateless current-Core replay. There is no TypeScript algorithm fallback.
 */
export async function analyzeNavigationDataset(dataset: CoreNavigationDataset, options: AppCoreOptions): Promise<CoreAnalysis> {
  if (isLiveWindow(dataset)) return (await ensureLiveEnvelope(dataset, options)).analysis;
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
  if (maxFrames <= 40 && isLiveWindow(dataset)) {
    const envelope = await ensureLiveEnvelope(dataset, options, true);
    return { history: envelope.history, events: envelope.events };
  }
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

export async function checkSoPairCompatibility(first: SoGeometryDescriptor, second: SoGeometryDescriptor, settings: SoGroupingSettings): Promise<SoGroupingEvidence> {
  const body = await rpc({ command: "so_pair_compatibility", first, second, settings });
  if (!body.evidence) throw new Error("Python Core response did not include SO grouping evidence");
  return body.evidence;
}
