# Blue Wolf — Architecture Decision Record v1.7 — Simplified Runtime

**Date:** 2026-09-06  
**Status:** User-approved decisions.  
**Rule:** Work Mode remains the infrastructure baseline; newer functional/UX behavior remains authoritative.

## ADR-01 — Canonical current Core is Python
The application-to-Core boundary remains language-neutral, but the **current canonical algorithm implementation is Python** under `core/src/bluewolf_core/`.

A future Core may replace Python if the contract remains compatible. The TypeScript package under `packages/bluewolf-core/` is a compatibility/reference implementation during migration and is not the canonical production algorithm.

## ADR-02 — One Core behavior for Live and Historical
- Live uses a long-lived `CoreSession` and feeds ordered batches.
- Investigation/history creates a fresh CoreSession and replays historical joined navigation through the same Python Core.
- No second historical scoring/grouping algorithm exists.

## ADR-03 — Logical grid and Batch
- Algorithm logical grid: 1 second.
- Live delivery: one ordered Batch every 5 seconds.
- A Batch contains the individual time points/samples and is never a five-second average.

## ADR-04 — Checkpoint cadence
Persist a CoreSession checkpoint **every 5 minutes**. No additional event-triggered checkpoint policy is required unless later requested.

## ADR-05 — Checkpoint payload
Checkpoint contains only the deterministic transient algorithm state required to continue/replay correctly, including route/group candidates and confirmations, lifecycle timers, active alert/event state, processed frontier, configuration fingerprint and algorithm/schema versions.

It excludes DB/network/UI handles and does not serve as a raw-navigation archive.

## ADR-06 — Navigation retention / source of truth
**InfluxDB is the historical source of truth for real navigation.**

Blue Wolf does not persist a duplicate permanent Raw NAV archive and does not persist Joined NAV permanently by default.

`Ingest + Join` is a computational layer. Joined data may exist in memory or in a short-lived performance cache, but it is reconstructible from Influx and is not authoritative persistence.

If a future Influx retention policy would delete navigation needed by Blue Wolf, an archive policy must be explicitly added then; it is not part of the current design.

## ADR-07 — Database backup
Back up application-owned persistent data daily and create a snapshot before a significant application version, schema or configuration migration.

The backup covers data not reconstructible from Influx, including configuration/workspace, templates, GT, route bank, user edits, audit and checkpoints. It does not duplicate the Influx navigation archive.

## ADR-08 — Membership timing
- Analysis/stability window: configurable in the 30–60 second working range.
- Candidate -> Assigned confirmation: 120 seconds of sustained compatibility.
- Score never directly determines membership.

## ADR-09 — Alert lifecycle
Retain stateful smoothing/persistence/hysteresis. Historical Work Mode thresholds are defaults, not hard-coded product facts, and remain configurable.

## ADR-10 — Mute
Current UX wins: mute options 5/15/30 minutes or until restart. Mute affects audio only; visual alert/evidence/event remains active.

## ADR-11 — Route functionality
The current functional route model and current SO/template-builder semantics remain authoritative. Old DR UI/examples do not revert them.

## ADR-12 — Generic closed-route representation
The external Core contract shall **not require exactly or at most 64 points**.

A closed route is represented generically by:
- topology/family/subtype when recognized;
- ordered canonical closed polyline with a variable number of points;
- center/orientation/axes/length/period when meaningful;
- semantic regions (leg/turn/connection) when meaningful;
- optional parametric geometry for recognized shapes.

This represents circles, octagons, hippodromes, double routes and arbitrary closed routes. Phase/progress is defined by normalized arc length along the canonical closed path when center-angle is not appropriate.

The implementation may internally resample to a bounded number of points for performance; that bound is an implementation detail, not a public-contract restriction.

## ADR-13 — No TTAG
TTAG is not part of Blue Wolf's required architecture, data contract or Join key.

The selected server/source configuration determines what Influx source is queried. The temporal Join uses real vehicle identity + timestamp + field mapping/measurement context. No logic may require TTAG.

## ADR-14 — Influx polling and active operator server
Defaults remain configurable:
- dormant servers: lightweight Probe every 5 minutes;
- normal awake polling: every 5 seconds;
- return to dormant after 5 minutes without real vehicle identifiers.

**Operator focus override:** when an operator opens/selects a specific server window, that server is immediately treated as awake and is queried/refreshed every 5 seconds. The UI does not wait for the dormant 5-minute Probe.

## ADR-15 — UI refresh / animation
The UI may refresh/animate more frequently than Core batches (Work Mode default 2 seconds). Animation may interpolate presentation only. It must not fabricate a new operational sample, position, score or Core result.

## ADR-16 — Manual GT score
Manual score/quality is permitted only inside GT/calibration/validation. It is never production Core input and never substitutes an operational result.

## ADR-17 — Historical algorithm results are recomputable
Automatic historical Score/Event/analysis frames are not permanent authoritative records. Investigation reads navigation from Influx, performs Join and reprocesses it with the **current canonical Python Core**.

Derived results may be cached for performance and deleted/recomputed at any time.

## ADR-18 — No historical Core-version museum
When the Core is replaced, the new canonical Core becomes the basis for future historical analysis as well. Blue Wolf does not retain old automatic analyses merely to reproduce old Core behavior.

Exported PDFs/reports are not retained by Blue Wolf solely for reproducibility; after export they may be discarded unless a separate future retention requirement is added. User-owned edits/audit remain persisted according to their own requirements.

## ADR-19 — Core replacement tests
A candidate Core must pass an independent Core gate covering at least:
- contract validation;
- Increment vs 5-second Batch equivalence;
- Live vs Replay equivalence;
- Checkpoint -> restore -> replay equivalence;
- route detection including non-circular closed paths;
- membership transitions and 120-second confirmation;
- score/alert behavior;
- missing/gapped/join-quality data;
- simulator Raw NAV -> Core -> independent GT comparison;
- no GT/network/UI/DB dependencies inside Core.

If the external Core contract is unchanged, algorithm development validation does not require testing every UI feature. Public release still runs integration/browser gates.

## ADR-20 — New functionality remains
All current functional work remains: current SO Builder, generated layouts and de-duplication, placement/direction semantics, current grouping law, navigation-derived scoring, explanatory navigation-derived wind estimate, Operator/Timeline, Investigation/PDF, Event-only maps, GT tools, 30-day deterministic simulator, Influx no-fallback and executable System Tests.

## Simplified persistence model
The resulting architecture intentionally has four clear categories:

1. **InfluxDB:** authoritative real navigation history.
2. **Ingest + Join:** reconstructible normalized input to Core; memory/temporary cache only by default.
3. **CoreSession checkpoint:** small five-minute recovery snapshot of algorithm state.
4. **Blue Wolf DB:** configuration/workspace, templates, GT, route bank, user edits, audit and checkpoints — data that cannot simply be reconstructed from Influx.

Automatic Scores/Events/analysis are computed from current Core + joined navigation and are not an additional permanent source of truth.
