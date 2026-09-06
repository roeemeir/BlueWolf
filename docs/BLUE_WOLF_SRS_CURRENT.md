# Blue Wolf — Current Official SRS

The official, mandatory product specification is the union of:

1. `docs/BLUE_WOLF_SRS.md` — authoritative baseline.
2. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md` — normative amendment v1.1.
3. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md` — normative amendment v1.2.
4. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_3.md` — normative amendment v1.3.
5. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_4.md` — newest normative amendment and single-navigation-truth contract.

**Precedence rule:** the newest normative amendment wins only where it explicitly conflicts with an older requirement. v1.4 therefore overrides older demo/static-data behavior, historical fixed-event behavior, Influx fallback behavior, wind-display provenance and System-Test shortcuts. All other older requirements remain mandatory.

Every release must be checked against all five documents. No feature may be declared implemented merely because a UI mock, hard-coded value, simulator truth field or decorative PASS exists. Release evidence must distinguish executable production analysis, simulator GT, external integration and unavailable/no-data states.
