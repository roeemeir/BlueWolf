# Blue Wolf — Current Official SRS

The official, mandatory product specification is the union of:

1. `docs/BLUE_WOLF_SRS.md` — authoritative baseline.
2. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md` — normative amendment v1.1.
3. `docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md` — normative amendment v1.2 and the newest product decisions.

**Precedence rule:** the newest normative amendment wins only where it explicitly conflicts with an older requirement. Therefore v1.2 overrides v1.1/baseline on SO template semantics, operational color identity, trail behavior, Investigation Event coloring/root causes, wind estimation and GT editing/map tools. All other older requirements remain mandatory.

Every release must be checked against all three documents. No feature may be declared implemented merely because a UI mock or hardcoded value exists. Release evidence must distinguish executable implementation, external integration and demo-only behavior.
