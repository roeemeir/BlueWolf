import type { AnalysisFrame, CoreAnalysis, CoreConfig, DerivedEvent, NavigationDataset, NavigationProvenance, RawNavigationSample, ScoreThresholds } from "./contracts.ts";
import { analyzeNavigationDataset, compareMembership } from "./analyzer.ts";

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function provenanceFromSamples(source: NavigationProvenance["source"], serverId: string, from: Date, to: Date, samples: RawNavigationSample[], warnings: string[] = []): NavigationProvenance {
  const vehicles = new Set(samples.map((sample) => sample.vehicleId));
  const times = [...new Set(samples.map((sample) => Date.parse(sample.timestamp)).filter(Number.isFinite))].sort((a, b) => a - b);
  const gaps = times.slice(1).map((value, index) => (value - times[index]) / 1000).filter((value) => value > 0);
  const samplingMedianSeconds = median(gaps); const latestMs = times.at(-1) ?? null;
  const expected = samplingMedianSeconds && samplingMedianSeconds > 0 ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 1000 / samplingMedianSeconds) + 1) * Math.max(1, vehicles.size) : null;
  return {
    source, serverId, from: from.toISOString(), to: to.toISOString(), latestSampleAt: latestMs == null ? null : new Date(latestMs).toISOString(), sampleCount: samples.length, vehicleCount: vehicles.size,
    samplingMedianSeconds, completenessPct: expected ? Math.min(100, samples.length / expected * 100) : null, freshnessSeconds: latestMs == null ? null : Math.max(0, (to.getTime() - latestMs) / 1000), warnings,
  };
}

function uniqueTimes(dataset: NavigationDataset) { return [...new Set(dataset.samples.map((sample) => sample.timestamp))].sort((a, b) => Date.parse(a) - Date.parse(b)); }

export function buildAnalysisHistory(dataset: NavigationDataset, config: CoreConfig, maxFrames = 61, lookbackMinutes = 12): AnalysisFrame[] {
  const times = uniqueTimes(dataset); if (!times.length) return [];
  const step = Math.max(1, Math.floor(times.length / maxFrames)); const selected = times.filter((_, index) => index % step === 0); if (selected.at(-1) !== times.at(-1)) selected.push(times.at(-1)!);
  return selected.map((timestamp) => {
    const end = new Date(timestamp), start = new Date(end.getTime() - lookbackMinutes * 60_000); const samples = dataset.samples.filter((sample) => { const ms = Date.parse(sample.timestamp); return ms >= start.getTime() && ms <= end.getTime(); });
    const slice: NavigationDataset = { samples, provenance: provenanceFromSamples(dataset.provenance.source, dataset.provenance.serverId, start, end, samples, dataset.provenance.warnings) };
    return { timestamp, analysis: analyzeNavigationDataset(slice, config) };
  });
}

function routeSignature(analysis: CoreAnalysis, key: "si" | "so") {
  const ids = new Set(analysis.groups[key].members); return analysis.routes.filter((route) => ids.has(route.vehicleId)).map((route) => `${route.vehicleId}:${route.kind}`).sort().join("|");
}
function stateKey(frame: AnalysisFrame, key: "si" | "so", thresholds: ScoreThresholds) {
  const group = frame.analysis.groups[key]; const periodBand = group.periodErrorPct >= thresholds.periodZeroPct ? "period-critical" : group.periodErrorPct > thresholds.periodFullPct ? "period-warning" : "period-ok";
  return `${group.members.slice().sort((a, b) => a - b).join(",")}#${routeSignature(frame.analysis, key)}#${periodBand}`;
}
function membershipText(change: ReturnType<typeof compareMembership>["si"]) {
  const parts: string[] = []; if (change.joined.length) parts.push(`הצטרפו ${change.joined.join(", ")}`); if (change.left.length) parts.push(`יצאו ${change.left.join(", ")}`); return parts.join("; ");
}
function boundaryReason(previous: AnalysisFrame | null, current: AnalysisFrame, key: "si" | "so", thresholds: ScoreThresholds) {
  const group = current.analysis.groups[key];
  if (!previous) return { text: `תחילת טווח: זוהתה קבוצת ${key.toUpperCase()} עם ${group.members.length} רכבים מתוך נתוני הניווט.`, evidence: [`רכבים: ${group.members.join(", ") || "אין"}`, `Sync ${group.score.sync}`, `Route ${group.score.route}`] };
  const membership = compareMembership(previous.analysis, current.analysis)[key]; const membershipReason = membershipText(membership);
  if (membershipReason) return { text: `שינוי חברות שאושר בחלון הניתוח: ${membershipReason}.`, evidence: [`לפני: ${previous.analysis.groups[key].members.join(", ") || "אין"}`, `אחרי: ${group.members.join(", ") || "אין"}`] };
  const oldRoute = routeSignature(previous.analysis, key), nextRoute = routeSignature(current.analysis, key);
  if (oldRoute !== nextRoute) return { text: "זוהה שינוי במשפחת/גאומטריית הנתיב מתוך עקבות הניווט ולכן נפתח אירוע חדש.", evidence: [`לפני: ${oldRoute || "אין"}`, `אחרי: ${nextRoute || "אין"}`] };
  const beforePeriod = previous.analysis.groups[key].periodErrorPct, nowPeriod = group.periodErrorPct;
  if ((beforePeriod <= thresholds.periodFullPct && nowPeriod > thresholds.periodFullPct) || (beforePeriod < thresholds.periodZeroPct && nowPeriod >= thresholds.periodZeroPct)) return { text: `פער זמן המחזור חצה סף: ${beforePeriod.toFixed(1)}% → ${nowPeriod.toFixed(1)}%.`, evidence: [`סף מלא ${thresholds.periodFullPct}%`, `סף אפס ${thresholds.periodZeroPct}%`] };
  return { text: "מצב הקבוצה השתנה לפי ראיות הניווט והוגדר גבול אירוע חדש.", evidence: [`Sync ${group.score.sync}`, `Route ${group.score.route}`, `Period error ${group.periodErrorPct.toFixed(1)}%`] };
}

export function deriveEvents(history: AnalysisFrame[], thresholds: ScoreThresholds): DerivedEvent[] {
  const events: DerivedEvent[] = [];
  for (const key of ["si", "so"] as const) {
    let currentFrames: AnalysisFrame[] = []; let currentState = ""; let startReason = ""; let startEvidence: string[] = [];
    const flush = (endReason: string, endEvidence: string[]) => {
      if (!currentFrames.length) return; const representative = currentFrames[Math.floor(currentFrames.length / 2)].analysis; const group = representative.groups[key];
      events.push({ id: "", index: 0, start: currentFrames[0].timestamp, end: currentFrames.at(-1)!.timestamp, family: key === "si" ? "SI" : "SO", groupKey: key, members: group.members, startReason, endReason, startEvidence, endEvidence, frames: currentFrames, representative }); currentFrames = [];
    };
    for (let i = 0; i < history.length; i++) {
      const frame = history[i]; const group = frame.analysis.groups[key];
      if (!group.members.length) { if (currentFrames.length) flush("הקבוצה חדלה להתקיים/להיות ניתנת לזיהוי בנתוני הניווט.", ["אין חברי קבוצה מזוהים"]); currentState = ""; continue; }
      const state = stateKey(frame, key, thresholds);
      if (!currentFrames.length) { const reason = boundaryReason(i ? history[i - 1] : null, frame, key, thresholds); startReason = reason.text; startEvidence = reason.evidence; currentState = state; currentFrames = [frame]; continue; }
      if (state !== currentState) { const boundary = boundaryReason(history[i - 1], frame, key, thresholds); flush(`האירוע הסתיים לפני שינוי מאושר: ${boundary.text}`, boundary.evidence); startReason = boundary.text; startEvidence = boundary.evidence; currentState = state; currentFrames = [frame]; } else currentFrames.push(frame);
    }
    if (currentFrames.length) flush("סוף טווח התחקור שנבחר; לא זוהה שינוי מאושר נוסף לפני הגבול.", [`סוף טווח: ${currentFrames.at(-1)!.timestamp}`]);
  }
  events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)); events.forEach((event, index) => { event.index = index; event.id = `E${index + 1}`; }); return events;
}
