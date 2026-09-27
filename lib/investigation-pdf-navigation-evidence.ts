import type { InvestigationPdfEvent } from "@/lib/investigation-pdf";
import {
  continuousObservedNavigationSegment,
  OBSERVED_NAVIGATION_MAX_DISPLAY_GAP_MS,
  OBSERVED_NAVIGATION_MAX_DISPLAY_SPEED_MPS,
  validObservedWgs84,
} from "./observed-navigation-continuity";

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

/** Navigation gaps and gross GPS jumps must obey precisely the operator map's
 * shared observed-evidence presentation guard, not independent PDF thresholds.
 * Neither display cutoff is a physical Core speed or scoring rule. */
export const PDF_NAVIGATION_MAX_GAP_MS = OBSERVED_NAVIGATION_MAX_DISPLAY_GAP_MS;
export const PDF_NAVIGATION_MAX_DISPLAY_SPEED_MPS = OBSERVED_NAVIGATION_MAX_DISPLAY_SPEED_MPS;

function validPosition(latitude: number | null, longitude: number | null): boolean {
  return latitude !== null && longitude !== null && validObservedWgs84({ latitude, longitude });
}

/**
 * A missing frame, invalid WGS84 pair, excessive time gap or impossible
 * displacement terminates a drawn segment. First/last refer to the first and
 * last ACTUALLY OBSERVED samples inside both event and report window, not an
 * inferred boundary position. No navigation evidence means no PDF marker.
 * A memberId must represent exactly one vehicleIdentifier in this event:
 * silently changing its identity would mix two vehicles into one PDF track.
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
      const rows = frame.navigation.filter((item) => item.memberId === memberId);
      if (rows.length > 1) throw new Error(`ambiguous PDF navigation: duplicate memberId ${memberId} in one frame`);
      const row = rows[0];
      if (!row || !validPosition(row.latitude, row.longitude)) { breakSegment(); continue; }
      if (!Number.isSafeInteger(row.vehicleIdentifier) || row.vehicleIdentifier < 0) {
        throw new Error(`invalid PDF navigation vehicleIdentifier for memberId ${memberId}`);
      }
      if (vehicleIdentifier !== null && vehicleIdentifier !== row.vehicleIdentifier) {
        throw new Error(`ambiguous PDF navigation: memberId ${memberId} changed vehicleIdentifier within one event`);
      }
      const observed: ObservedPosition = { observedAt: frame.observedAt, latitude: row.latitude as number, longitude: row.longitude as number };
      if (lastObservedMs !== null) {
        const prior = current.at(-1);
        if (!prior || !continuousObservedNavigationSegment(prior, observed, at - lastObservedMs)) {
          breakSegment();
        }
      }
      vehicleIdentifier = row.vehicleIdentifier;
      current.push(observed);
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
