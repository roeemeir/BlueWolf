# Blue Wolf — Current Official SRS

The official, mandatory product specification is the union of:

1. `docs/BLUE_WOLF_SRS.md` — authoritative baseline.
2. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md` — normative amendment v1.1.
3. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md` — normative amendment v1.2.
4. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_3.md` — normative amendment v1.3.
5. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_4.md` — single-navigation-truth amendment.
6. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_5.md` — newest amendment: replaceable Algorithm Core, preserved persistence architecture and strengthened data provenance/testing.

Supporting mandatory architecture document:
- `docs/BLUE_WOLF_ARCHITECTURE_V1_5.md`.

**Precedence rule:** the newest normative amendment wins only where it explicitly conflicts with an older requirement. v1.5 therefore overrides any older architecture in which production algorithms are embedded in UI modules or tests rely on synthetic operational results. v1.4 remains authoritative for single-navigation-truth behavior where not superseded. All non-conflicting older requirements remain mandatory.

Every release must be checked against all six SRS documents and Architecture v1.5. No feature may be declared implemented merely because a UI mock, hard-coded value, simulator truth field or decorative PASS exists. Release evidence must distinguish executable Algorithm Core output, simulator GT, external integration, persisted configuration and unavailable/no-data states.
