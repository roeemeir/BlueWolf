# AGENTS.md — Blue Wolf development guardrails

## Source of truth
1. Read `docs/REQUIREMENTS_2026_09_15_HE.md`, `docs/REQUIREMENTS_COVERAGE_HE.md` and the relevant `core/docs/*` before product changes.
2. The Drive full specification is the product source of truth; the repository registry mirrors it for implementation and CI.
3. Never reinterpret a frozen requirement silently. If code and requirement conflict, stop the conflicting change and record the gap.

## Frozen and protected behavior
1. `approved = כן` means frozen semantics. Only an explicit user change request may alter it.
2. `implemented = כן` means protected behavior. Add or retain a regression before refactoring it.
3. New work must not remove an existing implemented feature merely to simplify a new feature.

## Iteration protocol
1. Review every requirement with `מימוש != כן` and choose the iteration scope explicitly.
2. Run relevant baseline tests before touching protected paths when feasible.
3. Develop only on a work branch. Never publish a partial preview.
4. Replace demo/fake values with `missing/not run` until backed by an actual run. Never report fabricated QA counts, progress, scores or latency.
5. Run relevant Core, Web, TypeScript/lint, offline/SQLite, GT and report regressions after changes.
6. Mark a requirement `כן` only after concrete implementation plus actual verification.
7. Update requirements coverage and the research report for algorithm/threshold/architecture changes before release.
8. Publish only after the chosen release scope and required gates are green.

## Recovery note
The exact prior branch `work/requirements-2026-09-14` / commit `b79bf25` was not present in the currently connected GitHub repository on 15/09/2026. Work was recovered from `work/recovery-2026-09-14`, which is four commits ahead of `offline-sqlite-ui-review`, preserving the recovered offline/SQLite/WKT work. The recovery fact must not be represented as the missing commit having been restored.