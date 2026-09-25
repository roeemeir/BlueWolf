// A polled Core snapshot is a complete source-time frame, not an incremental
// patch. Late or repeated source timestamps must never replace newer live
// cards/alerts or become fresh missing-data evidence in the trace collector.
// Invalid timestamps are a CONTRACT FAILURE: throw so the poller clears the
// operational LIVE state, rather than preserving a formerly healthy snapshot.
// Date.parse by itself also accepts locale-dependent strings, zone-less local
// times and normalized-invalid dates (e.g. February 31). Those are NOT Core
// evidence timestamps and must not advance the operational source watermark.
function parseCoreSourceTime(observedAt: string): number {
  const invalid = () => new Error("invalid Core runtime snapshot observedAt");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(observedAt);
  if (!match) throw invalid();
  const [, y, m, d, h, minute, second, , zone] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59) throw invalid();
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) throw invalid();
  const sourceTimeMs = Date.parse(observedAt);
  if (!Number.isFinite(sourceTimeMs)) throw invalid();
  return sourceTimeMs;
}

export function newerRuntimeSnapshotTime(latestAcceptedTimeMs: number, observedAt: string): number | null {
  const sourceTimeMs = parseCoreSourceTime(observedAt);
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
    /**
     * A current transport/health response can repeat the last observed source
     * timestamp indefinitely while the Core is stale or offline. Accept its
     * CURRENT health state by HTTP request order, but never advance navigation
     * source time and never treat it as new position/score evidence.
     */
    acceptHealthSnapshot(serverId: string, requestId: number, observedAt: string): boolean {
      const state = stateFor(serverId);
      if (requestId < state.lastSettledRequestId) return false;
      parseCoreSourceTime(observedAt);
      state.lastSettledRequestId = requestId;
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
