import type { InvestigationPdfEvent } from "@/lib/investigation-pdf";

/** A recorded WGS84 position, never an interpolated or planned route point. */
export type ObservedPosition = {
  observedAt: string;
  latitude: number;
  longitude: number;
};
export type MemberNavigationEvidence = {
  memberId: string;
  vehicleIdentifier: number;
  segments: ObservedPosition[][];
  first: ObservedPosition;
  last: ObservedPosition;
};

/** Navigation samples are expected every 1–2 seconds; larger gaps must never
 * be joined by a visually invented straight track. Match the map trace's
 * conservative 10-second continuity guard, without synthesizing a position. */
export const PDF_NAVIGATION_MAX_GAP_MS = 10_000;

function validPosition(latitude: number | null, longitude: number | null): boolean {
  return latitude !== null && longitude !== null
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

/**
 * A missing frame, invalid WGS84 pair or excessive time gap terminates a
 * drawn segment. First/last refer to the first and last ACTUALLY OBSERVED
 * samples inside both event and report window, not an inferred boundary
 * position. No navigation evidence means no PDF position marker.
 */
export function investigationEventNavigationEvidence(
  event: InvestigationPdfEvent,
  reportFromMs: number,
  reportToMs: number,
): MemberNavigationEvidence[] {
  const start = Math.max(Date.parse(event.result.startAt), reportFromMs);
  const end = Math.min(Date.parse(event.result.endAt), reportToMs);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];
  const orderedFrames = [...event.result.points].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const memberIds = [...new Set(orderedFrames.flatMap((frame) => frame.navigation.map((row) => row.memberId)))].sort();
  const evidence: MemberNavigationEvidence[] = [];
  for (const memberId of memberIds) {
    const segments: ObservedPosition[][] = [];
    let current: ObservedPosition[] = [];
    let lastObservedMs: number | null = null;
    let vehicleIdentifier: number | null = null;
    const breakSegment = () => { if (current.length) segments.push(current); current = []; lastObservedMs = null; };
    for (const frame of orderedFrames) {
      const at = Date.parse(frame.observedAt);
      if (!Number.isFinite(at) || at < start || at > end) { breakSegment(); continue; }
      const row = frame.navigation.find((item) => item.memberId === memberId);
      if (!row || !validPosition(row.latitude, row.longitude)) { breakSegment(); continue; }
      if (lastObservedMs !== null && (at - lastObservedMs > PDF_NAVIGATION_MAX_GAP_MS || at <= lastObservedMs)) breakSegment();
      vehicleIdentifier = row.vehicleIdentifier;
      current.push({ observedAt: frame.observedAt, latitude: row.latitude as number, longitude: row.longitude as number });
      lastObservedMs = at;
    }
    breakSegment();
    if (!segments.length) continue;
    const first = segments[0][0];
    const lastSegment = segments[segments.length - 1];
    evidence.push({ memberId, vehicleIdentifier: vehicleIdentifier!, segments, first, last: lastSegment[lastSegment.length - 1] });
  }
  return evidence;
}
