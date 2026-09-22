// A polled Core snapshot is a complete source-time frame, not an incremental
// patch. Late, repeated or invalid source timestamps must never replace newer
// live cards/alerts or be passed to the trace collector as fresh missing data.
// The caller owns one latest-time cursor per active server/mode subscription.
export function newerRuntimeSnapshotTime(latestAcceptedTimeMs: number, observedAt: string): number | null {
  const sourceTimeMs = Date.parse(observedAt);
  return Number.isFinite(sourceTimeMs) && sourceTimeMs > latestAcceptedTimeMs ? sourceTimeMs : null;
}
