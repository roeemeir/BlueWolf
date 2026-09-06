# Blue Wolf — Current Official SRS

The official, mandatory product specification is the union of:

1. `docs/BLUE_WOLF_SRS.md` — authoritative baseline.
2. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md` — normative amendment v1.1.
3. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md` — normative amendment v1.2.
4. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_3.md` — functional amendment v1.3.
5. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_4.md` — single-navigation-truth amendment.
6. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_5.md` — replaceable-Core/data-truth amendment.
7. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_6_WORKMODE_ARCHITECTURE.md` — newest architecture amendment restoring the original Work Mode / validated-DR topology, batching, CoreSession, storage and runtime state machines while preserving newer functionality.

Supporting mandatory architecture document:
- `docs/BLUE_WOLF_ARCHITECTURE_V1_6_WORKMODE_CANONICAL.md`.

## Precedence rule

Two axes of precedence are used deliberately:

- **Architecture / infrastructure:** v1.6 Work Mode architecture is authoritative unless the user explicitly selects another option in the conflict matrix.
- **Product functionality / UX:** the newest functional requirement is authoritative. Historical DR examples do not roll back newer Template Builder, SO semantics, map/timeline, Investigation/PDF, GT, wind-estimation or navigation-truth behavior.

All non-conflicting older requirements remain mandatory.

## Release truth rule

No feature may be declared implemented merely because a UI mock, hard-coded value, simulator truth field or decorative PASS exists. Release evidence must distinguish:
- normalized source navigation;
- executable Algorithm Core output;
- persistent CoreSession state/checkpoint;
- simulator GT;
- external integration state;
- persisted configuration/operational records;
- unavailable/no-data states.

A release that changes only Core internals may use the independent Core gate for development validation when the external contract is unchanged. A public release/preview still requires the complete integrated release gate.
