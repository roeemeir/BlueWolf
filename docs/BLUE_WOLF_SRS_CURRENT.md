# Blue Wolf — Current Official SRS

The official, mandatory product specification is the union of:

1. `docs/BLUE_WOLF_SRS.md` — authoritative baseline.
2. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md` — normative amendment v1.1.
3. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md` — normative amendment v1.2.
4. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_3.md` — functional amendment v1.3.
5. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_4.md` — single-navigation-truth amendment.
6. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_5.md` — replaceable-Core/data-truth amendment.
7. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_6_WORKMODE_ARCHITECTURE.md` — restored Work Mode architecture baseline.
8. `docs/BLUE_WOLF_ARCHITECTURE_DECISIONS_2026-09-06_V1_7.md` — explicit user-approved simplified architecture decisions.

Current mandatory architecture:
- `docs/BLUE_WOLF_ARCHITECTURE_V1_7_SIMPLIFIED_CANONICAL.md`.

## Precedence rule

- **Architecture / infrastructure:** v1.7 canonical architecture + approved ADR decisions are authoritative.
- **Product functionality / UX:** the newest functional requirement is authoritative. Historical DR examples do not roll back newer Template Builder, SO semantics, map/timeline, Investigation/PDF, GT, wind-estimation or navigation-truth behavior.

All non-conflicting older requirements remain mandatory.

## Current architecture headline

`InfluxDB / Replay / Simulator -> Ingest + Join -> Python CoreSession -> UI`

- InfluxDB is authoritative real-navigation history.
- Joined NAV is reconstructible and is not permanently persisted by default.
- Python `CoreSession` is the current canonical algorithm implementation.
- Checkpoint every 5 minutes enables fast restart/replay.
- Blue Wolf DB stores only non-reconstructible product state: Workspace/config, templates, GT, route bank, user edits, audit and checkpoints.
- Automatic historical Scores/Events are recomputed with the current canonical Core and may be cached/discarded.
- TTAG is not required anywhere in the architecture.

## Release truth rule

No feature may be declared implemented merely because a UI mock, hard-coded value, simulator truth field or decorative PASS exists. Release evidence must distinguish:
- normalized source navigation;
- Joined NAV input to Core;
- executable Python Algorithm Core output;
- persistent CoreSession checkpoint;
- simulator GT;
- external integration state;
- persisted configuration/user state;
- unavailable/no-data states.

A Core-only internal change may use the independent Python Core gate for development validation when the external contract is unchanged. A public release/preview still requires the complete integrated release gate.
