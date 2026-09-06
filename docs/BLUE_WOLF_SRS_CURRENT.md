# Blue Wolf — Current Official SRS

The official, mandatory product specification is the union of:

1. `docs/BLUE_WOLF_SRS.md` — authoritative baseline.
2. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md` — normative amendment v1.1.
3. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md` — normative amendment v1.2.
4. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_3.md` — normative amendment v1.3 and the newest product decisions.

**Precedence rule:** the newest normative amendment wins only where it explicitly conflicts with an older requirement. Therefore v1.3 overrides v1.2/v1.1/baseline on wind/scoring semantics, SO grouping legality, operator template switching, simulation servers 2–3, Investigation/PDF event maps, vehicle evidence tables, root-cause wording, SO auto-layout generation, engineering-map rendering and executable System Tests. All non-conflicting older requirements remain mandatory.

Every release must be checked against all four documents. No feature may be declared implemented merely because a UI mock, hardcoded display value, synthetic score series or placeholder test exists. Release evidence must distinguish executable implementation, external integration and demo-only behavior.
