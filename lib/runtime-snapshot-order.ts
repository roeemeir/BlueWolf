// A polled Core snapshot is a complete source-time frame, not an incremental
// patch. Late or repeated source timestamps must never replace newer live
// cards/alerts or become fresh missing-data evidence in the trace collector.
// Invalid timestamps are a CONTRACT FAILURE: throw so the poller clears the
// operational LIVE state, rather than preserving a formerly healthy snapshot.
// The caller owns one cursor per active server/mode subscription.
export function newerRuntimeSnapshotTime(latestAcceptedTimeMs: number, observedAt: string): number | null {
  const sourceTimeMs = Date.parse(observedAt);
  if (!Number.isFinite(sourceTimeMs)) throw new Error("invalid Core runtime snapshot observedAt");
  return sourceTimeMs > latestAcceptedTimeMs ? sourceTimeMs : null;
}
