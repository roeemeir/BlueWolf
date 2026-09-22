// A polled Core snapshot is a complete source-time frame, not an incremental
// patch. Late or repeated source timestamps must never replace newer live
// cards/alerts or become fresh missing-data evidence in the trace collector.
// Invalid timestamps are a CONTRACT FAILURE: throw so the poller clears the
// operational LIVE state, rather than preserving a formerly healthy snapshot.
export function newerRuntimeSnapshotTime(latestAcceptedTimeMs: number, observedAt: string): number | null {
  const sourceTimeMs = Date.parse(observedAt);
  if (!Number.isFinite(sourceTimeMs)) throw new Error("invalid Core runtime snapshot observedAt");
  return sourceTimeMs > latestAcceptedTimeMs ? sourceTimeMs : null;
}

type ServerPollState = {
  nextRequestId: number;
  lastSettledRequestId: number;
  acceptedTimeMs: number;
};

/**
 * One instance per mounted operator application, retained across React effect
 * restarts (including refresh-cadence changes and switching away/back to a
 * server). Request IDs and source-time watermarks are independent per server.
 * A failed newer request must not be overwritten by an older late success;
 * a successful newer request must not be cleared by an older late failure.
 * This is display/poll ordering only and never modifies Core measurements.
 */
export function createRuntimePollOrder() {
  const states = new Map<string, ServerPollState>();
  const stateFor = (serverId: string): ServerPollState => {
    let state = states.get(serverId);
    if (!state) {
      state = { nextRequestId: 0, lastSettledRequestId: 0, acceptedTimeMs: Number.NEGATIVE_INFINITY };
      states.set(serverId, state);
    }
    return state;
  };
  return {
    begin(serverId: string): number {
      return ++stateFor(serverId).nextRequestId;
    },
    acceptSnapshot(serverId: string, requestId: number, observedAt: string): boolean {
      const state = stateFor(serverId);
      if (requestId < state.lastSettledRequestId) return false;
      const acceptedTimeMs = newerRuntimeSnapshotTime(state.acceptedTimeMs, observedAt);
      state.lastSettledRequestId = requestId;
      if (acceptedTimeMs === null) return false;
      state.acceptedTimeMs = acceptedTimeMs;
      return true;
    },
    acceptFailure(serverId: string, requestId: number): boolean {
      const state = stateFor(serverId);
      if (requestId < state.lastSettledRequestId) return false;
      state.lastSettledRequestId = requestId;
      return true;
    },
  };
}
