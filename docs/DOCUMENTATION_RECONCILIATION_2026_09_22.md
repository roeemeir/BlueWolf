# Documentation reconciliation ledger 22 September 2026

The existing Drive Master and subordinate research were read on 22 September. This is a source-delta inventory and focused audit, not documentation certification. BW-GOV-010 stays blocked; its manifest fingerprint is unchanged.

Fingerprint baseline: `8e859273560d61af09095352579f37a94c4d45b1`. Observed branch HEAD: `7191b5b2ae144f82a860f08571072cfb93a23f24`. There are 48 changed tracked implementation files since that baseline, across a 254-file implementation tree (240 at baseline). Unchanged files are not recertified by this ledger. The source fingerprint excludes tests and documentation.

| Change | Implementation path | Review status |
|---|---|---|
| M | `app/api/investigation/events/route.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `app/api/investigation/recompute/route.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `app/api/investigation/report/route.ts` | Reviewed for simulation range/clock and Core report provenance; fixture-only fix; broader Web/PDF snapshot acceptance OPEN. |
| M | `app/api/workspace/route.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `app/layout.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `app/mobile-map-influx.css` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/app-context.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/dashboard-app.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/developer-governance-workbench.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/developer-view.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `components/bluewolf/general-settings-workbench.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/gt-scenario-workbench.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/investigation-report-panel.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/investigation-workspace.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/operational-live-map.tsx` | Reviewed; historical cursor and cross-server evidence defects fixed in this iteration; visual acceptance pending. |
| M | `components/bluewolf/operator-view.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/route-bank-wkt-workbench.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/si-template-governance-workbench.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/so-governed-visuals.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `components/bluewolf/vehicle-range-workbench.tsx` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `core/src/bluewolf_runtime_adapter/si_template_config.py` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/bluewolf.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/default-map-profile.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/display-score-smoothing.ts` | Reviewed; raw-copy trailing arithmetic mean stops at server/event/group/invalid-score boundary; CI #2533 regression passed. |
| A | `lib/investigation-event-evidence-he.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/investigation-pdf-brand.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/investigation-pdf-event-synopsis.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/investigation-pdf-logo-offline.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/investigation-pdf-navigation-evidence.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/investigation-pdf-release.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/investigation-pdf-wmts.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/investigation-recompute-identity.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/investigation-report-data.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/live-notifications.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/observed-navigation-continuity.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/operational-alert-he.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/operational-map-projection.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/operator-retroactive-result.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/operator-time-cursor.ts` | Reviewed; source-time lookup tolerance and no-future-fix rule retained; calling-map null fallback fixed. |
| M | `lib/score-trace.ts` | Reviewed; invalid fixes are filtered before merge, so short missing-fix boundary preservation remains OPEN. |
| M | `lib/si-direct-placement.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/si-runtime-config.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/simulation-investigation.ts` | Reviewed for UTC window and report clock; rolling seven-calendar-day retention retained; API fixture clock corrected. |
| A | `lib/simulation-live-navigation.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/so-geometry.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| A | `lib/so-route-clearance.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/vehicle-id-ranges.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |
| M | `lib/workspace-validation.ts` | Pending source-to-Master/research reconciliation; previous CI is not documentation acceptance. |

`lib/live-map-evidence.ts` is additionally changed after the observed HEAD: serverId/groupId are preserved in the extracted evidence. The map validates this identity on response and render. No Core algorithm or threshold changes in this iteration.

Remaining governance work: reconcile every pending delta against the relevant Master paragraphs, update contradictory historical implementation notes without rewriting requirements, register the 17 corrective requests in the repository registry with faithful statuses, and verify edited original Drive documents. Only then consider a fingerprint refresh with a documented audit baseline; never infer user approval from CI.
