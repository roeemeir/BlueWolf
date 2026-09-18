import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandExpectedIds } from './verify-full-requirements-registry.mjs';

export const CURRENT_HEAD_AUDIT_SCHEMA_VERSION = 'bluewolf.current-head-audit.v1';

const FAMILY_REVIEW = {
  'BW-GOV': {
    implementationLocation: ['docs/full-requirements-registry.json', 'scripts/verify-full-requirements-registry.mjs', '.github/workflows/release-gate.yml'],
    acceptanceEvidence: ['tests/current-head-audit.test.mjs', 'tests/release-scope-gate.test.mjs'],
  },
  'BW-CORE': {
    implementationLocation: ['core/src/bluewolf_core', 'core/src/bluewolf_runtime_adapter'],
    acceptanceEvidence: ['core/tests'],
  },
  'BW-SYNC': {
    implementationLocation: ['core/src/bluewolf_core', 'components/bluewolf/si-template-governance-workbench.tsx', 'components/bluewolf/so-template-governance-workbench.tsx'],
    acceptanceEvidence: ['core/tests', 'tests/si-direct-placement.test.mjs', 'tests/so-direct-placement.test.mjs'],
  },
  'BW-DATA': {
    implementationLocation: ['core/src/bluewolf_runtime_adapter', 'app/api/live-runtime', 'lib/live-runtime.ts'],
    acceptanceEvidence: ['core/tests/test_runtime_service.py', 'tests/live-runtime-contract.test.mjs', 'tests/influx-runtime-config.test.mjs'],
  },
  'BW-OFF': {
    implementationLocation: ['lib/sqlite-workspace.ts', 'lib/sqlite-migrations.ts', 'scripts/start-offline.mjs', 'app/api/map-sources'],
    acceptanceEvidence: ['tests/sqlite-migrations.test.mjs', 'tests/map-source-config.test.mjs', 'scripts/verify-offline-http.mjs'],
  },
  'BW-DEV': {
    implementationLocation: ['components/bluewolf/developer-governance-workbench.tsx', 'app/api/gt-scenarios/route.ts', 'lib/gt-scenario-contract.ts'],
    acceptanceEvidence: ['tests/developer-tabs-ui.test.mjs', 'tests/gt-scenarios.test.mjs', 'tests/gt-provenance.test.mjs'],
  },
  'BW-UI': {
    implementationLocation: ['components/bluewolf/operator-view.tsx', 'components/bluewolf/operational-live-map.tsx', 'components/bluewolf/operational-timeline.tsx'],
    acceptanceEvidence: ['tests/op02-map-layers.test.mjs', 'tests/operator-time-cursor.test.mjs', 'scripts/verify_ui_browser_e2e.py'],
  },
  'BW-REP': {
    implementationLocation: ['components/bluewolf/investigation-workspace.tsx', 'app/api/investigation/report/route.ts', 'lib/investigation-report-data.ts'],
    acceptanceEvidence: ['tests/investigation-contract.test.mjs', 'tests/investigation-pdf-browser.test.mjs', 'tests/investigation-lifecycle.test.mjs'],
  },
  'BW-QA': {
    implementationLocation: ['scripts', 'tests', '.github/workflows'],
    acceptanceEvidence: ['tests/release-scope-gate.test.mjs', 'tests/current-head-audit.test.mjs', '.github/workflows/ci.yml'],
  },
  'BW-DOC': {
    implementationLocation: ['docs'],
    acceptanceEvidence: ['docs/full-requirements-registry.json', 'scripts/verify-full-requirements-registry.mjs'],
  },
};

const LATE_REVIEW = {
  OP: {
    implementationLocation: ['components/bluewolf/operator-view.tsx', 'components/bluewolf/operational-live-map.tsx', 'components/bluewolf/operational-timeline.tsx'],
    acceptanceEvidence: ['tests/op02-map-layers.test.mjs', 'tests/operator-time-cursor-ui.test.mjs', '.github/workflows/operator-acceptance.yml'],
  },
  GEO: {
    implementationLocation: ['lib/so-geometry.ts', 'components/bluewolf/so-governed-visuals.tsx'],
    acceptanceEvidence: ['tests/so-geometry.test.mjs'],
  },
  SI: {
    implementationLocation: ['lib/si-direct-placement.ts', 'components/bluewolf/si-template-governance-workbench.tsx'],
    acceptanceEvidence: ['tests/si-direct-placement.test.mjs', 'tests/si-direct-template-ui.test.mjs', 'tests/si-coordinate-template-ui.test.mjs'],
  },
  SO: {
    implementationLocation: ['lib/so-direct-placement.ts', 'lib/so-geometry.ts', 'components/bluewolf/so-template-governance-workbench.tsx'],
    acceptanceEvidence: ['tests/so-direct-placement.test.mjs', 'tests/so-direct-template-ui.test.mjs', 'tests/so-geometry.test.mjs'],
  },
  UI: {
    implementationLocation: ['components/bluewolf/operator-view.tsx', 'components/bluewolf/investigation-workspace.tsx', 'app/globals.css'],
    acceptanceEvidence: ['scripts/verify_ui_browser_e2e.py', '.github/workflows/ui-e2e.yml'],
  },
  REP: {
    implementationLocation: ['components/bluewolf/investigation-workspace.tsx', 'lib/investigation-pdf-release.ts', 'app/api/investigation/report/route.ts'],
    acceptanceEvidence: ['tests/investigation-pdf-browser.test.mjs', 'tests/investigation-lifecycle.test.mjs'],
  },
  CFG: {
    implementationLocation: ['lib/workspace-validation.ts', 'components/bluewolf/developer-governance-workbench.tsx'],
    acceptanceEvidence: ['tests/workspace-validation.test.mjs'],
  },
  IN: {
    implementationLocation: ['lib/influx-runtime-config.ts', 'lib/influx-runtime-sync.ts'],
    acceptanceEvidence: ['tests/influx-runtime-config.test.mjs', 'tests/influx-runtime-sync.test.mjs', '.github/workflows/in01-influx-config.yml'],
  },
  BANK: {
    implementationLocation: ['components/bluewolf/route-bank-wkt-workbench.tsx', 'lib/route-bank-geometry.ts'],
    acceptanceEvidence: ['tests/route-bank-wkt.test.mjs', 'scripts/verify_wkt_browser_e2e.py'],
  },
  TEST: {
    implementationLocation: ['core/src/bluewolf_runtime_adapter/qa_runner.py', 'components/bluewolf/qa-truth-workbench.tsx'],
    acceptanceEvidence: ['core/tests/test_qa_service.py', 'tests/qa-truth-contract.test.mjs'],
  },
  ARCH: {
    implementationLocation: ['scripts/start-offline.mjs', 'lib/sqlite-workspace.ts', 'core/src/bluewolf_runtime_adapter'],
    acceptanceEvidence: ['scripts/verify-offline-http.mjs', '.github/workflows/ci.yml', '.github/workflows/off09-workday.yml'],
  },
  PROC: {
    implementationLocation: ['docs/full-requirements-registry.json', 'scripts/build-current-head-audit.mjs', 'scripts/verify-full-requirements-registry.mjs', '.github/workflows/release-gate.yml'],
    acceptanceEvidence: ['tests/current-head-audit.test.mjs', 'tests/release-scope-gate.test.mjs'],
  },
};

const MANUAL_REVERIFY_REQUIRED = new Set([
  'OP-01', 'OP-02', 'OP-04',
  'SI-01', 'SO-01', 'SO-02', 'UI-01',
  'REP-01', 'REP-02', 'REP-03', 'REP-04',
  'BW-DEV-001',
  'BW-UI-005', 'BW-UI-009', 'BW-UI-010', 'BW-UI-012', 'BW-UI-014',
  'BW-REP-001', 'BW-REP-003', 'BW-REP-004', 'BW-REP-008',
  'BW-SYNC-013',
]);

const VERIFIED = {
  'BW-GOV-007': ['docs/development-iteration-review.json', 'scripts/verify-development-iteration.mjs', 'tests/development-iteration-review.test.mjs', '.github/workflows/release-gate.yml'],
  'BW-CORE-009': ['core/src/bluewolf_core/config.py', 'core/src/bluewolf_core/route_change.py', 'core/src/bluewolf_core/session.py', 'core/src/bluewolf_core/live_si_runtime.py', 'core/src/bluewolf_core/live_so_event_runtime.py', 'core/tests/test_route_change.py', 'core/tests/test_si_producer.py', 'core/tests/test_live_so_event_runtime.py', '.github/workflows/core09-material-event.yml'],
  'BW-DATA-010': ['core/src/bluewolf_ingest/influxdb2.py', 'core/src/bluewolf_ingest/window_reader.py', 'core/src/bluewolf_runtime_adapter/ingest_coordinator.py', 'core/src/bluewolf_runtime_adapter/operational_pipeline.py', 'core/src/bluewolf_runtime_adapter/service.py', 'core/tests/test_latency_budget.py', 'core/tests/test_latency_influx_e2e.py', '.github/workflows/data10-latency.yml'],
  'BW-DEV-002': ['components/bluewolf/route-bank-wkt-workbench.tsx', 'tests/route-bank-wkt.test.mjs'],
  'BW-DEV-003': ['components/bluewolf/route-bank-wkt-workbench.tsx', 'lib/route-bank-geometry.ts', 'scripts/verify_wkt_browser_e2e.py'],
  'BW-DEV-004': ['lib/vehicle-id-ranges.ts', 'tests/vehicle-id-ranges.test.mjs'],
  'BW-DEV-005': ['lib/workspace-validation.ts', 'tests/workspace-validation.test.mjs'],
  'BW-DEV-008': ['lib/gt-scenario-contract.ts', 'lib/sqlite-gt-scenarios.ts', 'tests/gt-scenarios.test.mjs'],
  'BW-DEV-009': ['app/api/gt-scenarios/route.ts', 'lib/sqlite-gt-scenarios.ts', 'tests/gt-scenarios.test.mjs'],
  'BW-DEV-010': ['core/src/bluewolf_runtime_adapter/qa_runner.py', 'core/tests/test_qa_service.py'],
  'BW-DEV-011': ['lib/qa-contract.ts', 'tests/gt-provenance.test.mjs'],
  'BW-DEV-012': ['components/bluewolf/qa-truth-workbench.tsx', 'tests/qa-truth-contract.test.mjs'],
  'BW-DEV-013': ['core/src/bluewolf_runtime_adapter/qa_runner.py', 'core/tests/test_qa_service.py'],
  'BW-DEV-014': ['app/api/qa/run/route.ts', 'tests/qa-truth-contract.test.mjs'],
  'BW-DEV-015': ['lib/sqlite-gt-scenarios.ts', 'tests/gt-scenarios.test.mjs'],
  'BW-OFF-004': ['lib/workspace-validation.ts', 'tests/workspace-wkt-api.test.mjs'],
  'BW-OFF-005': ['components/bluewolf/route-bank-wkt-workbench.tsx', 'scripts/verify_wkt_browser_e2e.py'],
  'BW-OFF-006': ['scripts/verify-offline-http.mjs', '.github/workflows/wkt-e2e.yml'],
  'BW-OFF-009': ['.github/workflows/off09-workday.yml', 'scripts/verify-offline-http.mjs'],
  'BW-OFF-010': ['lib/wmts-capabilities.ts', 'lib/map-source-config.ts', 'lib/default-map-profile.ts', 'lib/local-map-source-server.ts', 'app/api/map-sources/capabilities/route.ts', 'tests/wmts-capabilities.test.mjs', 'tests/map-source-config.test.mjs', 'tests/map-source-secret-store.test.mjs', 'tests/default-map-profile.test.mjs', 'scripts/verify-omniscale-wmts.mjs', '.github/workflows/off10-map-sources.yml'],
  'BW-OFF-011': ['app/api/workspace/scope/route.ts', 'tests/workspace-scopes.test.mjs'],
  'BW-OFF-012': ['lib/sqlite-migrations.ts', 'tests/sqlite-migrations.test.mjs', '.github/workflows/off12-migrations.yml'],
  'BW-SYNC-003': ['lib/si-direct-placement.ts', 'components/bluewolf/si-template-governance-workbench.tsx', 'tests/si-direct-template-ui.test.mjs'],
  'BW-SYNC-009': ['core/src/bluewolf_core/event_recompute.py', 'tests/investigation-contract.test.mjs'],
  'BW-SYNC-010': ['core/src/bluewolf_core/event_recompute.py', 'core/tests/test_event_recompute.py'],
  'BW-SYNC-011': ['core/src/bluewolf_core/event_recompute.py', 'lib/investigation-contract.ts'],
  'BW-SYNC-012': ['lib/si-runtime-sync.ts', 'core/src/bluewolf_runtime_adapter/si_template_config.py', 'core/src/bluewolf_runtime_adapter/si_producer.py', 'core/tests/test_si_producer.py', '.github/workflows/si-live-runtime.yml'],
  'BW-SYNC-013': ['lib/display-score-smoothing.ts', 'tests/display-score-smoothing.test.mjs', 'components/bluewolf/operational-timeline.tsx'],
  'BW-UI-005': ['lib/operator-time-cursor.ts', 'components/bluewolf/operational-timeline.tsx', 'components/bluewolf/operational-live-map.tsx', 'tests/operator-time-cursor.test.mjs', 'tests/operator-time-cursor-ui.test.mjs'],
  'BW-UI-006': ['app/api/investigation/events/route.ts', 'tests/investigation-contract.test.mjs'],
  'BW-UI-007': ['components/bluewolf/operator-view.tsx', 'tests/operator-alert-mute.test.mjs'],
  'BW-UI-008': ['core/src/bluewolf_core/live_so_event_runtime.py', 'core/src/bluewolf_runtime_adapter/contract.py', 'core/tests/test_live_runtime_contract.py', 'components/bluewolf/operator-view.tsx', 'components/bluewolf/operational-timeline.tsx', 'tests/operator-event-alert-linkage.test.mjs', '.github/workflows/operator-acceptance.yml'],
  'BW-UI-009': ['components/bluewolf/investigation-workspace.tsx', 'scripts/verify_ui_browser_e2e.py'],
  'BW-UI-010': ['components/bluewolf/operator-view.tsx', 'tests/ui-components.test.mjs'],
  'BW-UI-014': ['components/bluewolf/operational-live-map.tsx', 'tests/op02-map-layers.test.mjs', 'tests/map-source-ui.test.mjs'],
  'BW-REP-003': ['components/bluewolf/investigation-workspace.tsx', 'tests/investigation-lifecycle.test.mjs'],
  'BW-REP-004': ['components/bluewolf/investigation-workspace.tsx', 'tests/investigation-contract.test.mjs'],
  'BW-REP-007': ['core/src/bluewolf_core/event_recompute.py', 'tests/investigation-retroactive.test.mjs'],
  'BW-REP-009': ['app/api/investigation/report/route.ts', 'lib/investigation-report-data.ts', 'tests/investigation-pdf-browser.test.mjs'],
  'BW-QA-003': ['scripts/verify_wkt_browser_e2e.py', '.github/workflows/wkt-e2e.yml'],
  'BW-QA-004': ['core/src/bluewolf_runtime_adapter/qa_runner.py', 'core/tests/test_qa_service.py'],
  'BW-QA-005': ['core/tests/test_event_recompute.py', 'tests/investigation-retroactive.test.mjs'],
  'BW-QA-006': ['tests/investigation-pdf-browser.test.mjs', 'tests/investigation-report-route.test.mjs'],
  'BW-QA-007': ['scripts/verify-release-scope.mjs', 'tests/release-scope-gate.test.mjs', '.github/workflows/release-gate.yml'],
  'BW-QA-008': ['lib/runtime-provenance-server.ts', 'app/api/gt-scenarios/route.ts', 'tests/gt-provenance.test.mjs', 'tests/release-provenance.test.mjs'],
  'GEO-01': ['lib/so-geometry.ts', 'tests/so-geometry.test.mjs'],
  'GEO-02': ['lib/so-geometry.ts', 'tests/so-geometry.test.mjs'],
  'SI-01': ['components/bluewolf/si-template-governance-workbench.tsx', 'tests/si-direct-template-ui.test.mjs', 'tests/si-coordinate-template-ui.test.mjs'],
  'SI-02': ['lib/si-direct-placement.ts', 'tests/si-direct-placement.test.mjs'],
  'SO-01': ['lib/so-direct-placement.ts', 'components/bluewolf/so-template-governance-workbench.tsx', 'tests/so-direct-placement.test.mjs', 'tests/so-direct-template-ui.test.mjs'],
  'SO-02': ['lib/so-geometry.ts', 'lib/so-direct-placement.ts', 'tests/so-geometry.test.mjs'],
  'UI-01': ['components/bluewolf/investigation-workspace.tsx', 'scripts/verify_ui_browser_e2e.py'],
  'REP-01': ['components/bluewolf/investigation-workspace.tsx', 'lib/investigation-pdf-release.ts', 'tests/investigation-pdf-browser.test.mjs'],
  'IN-01': ['lib/influx-runtime-config.ts', 'lib/influx-runtime-sync.ts', 'tests/influx-runtime-config.test.mjs'],
  'BANK-01': ['components/bluewolf/route-bank-wkt-workbench.tsx', 'lib/route-bank-geometry.ts', 'tests/route-bank-wkt.test.mjs', 'scripts/verify_wkt_browser_e2e.py'],
  'TEST-01': ['core/src/bluewolf_runtime_adapter/qa_runner.py', 'core/tests/test_qa_service.py'],
  'ARCH-01': ['scripts/start-offline.mjs', 'lib/sqlite-workspace.ts', '.github/workflows/ci.yml'],
  'ARCH-02': ['core/src/bluewolf_runtime_adapter/family_environment_factory.py', 'core/src/bluewolf_runtime_adapter/family_runtime.py', 'core/src/bluewolf_runtime_adapter/composite_producer.py', 'core/src/bluewolf_runtime_adapter/operational_state.py', 'core/src/bluewolf_runtime_adapter/runtime_config_common.py', 'core/src/bluewolf_runtime_adapter/so_family_config.py', 'core/src/bluewolf_core/live_si_runtime.py', 'core/tests/test_family_runtime_symmetry.py', 'core/tests/test_mixed_environment_factory.py', 'core/tests/test_live_si_scoring.py', '.github/workflows/si-live-runtime.yml'],
  'PROC-01': ['scripts/build-current-head-audit.mjs', 'scripts/verify-full-requirements-registry.mjs', '.github/workflows/release-gate.yml', 'tests/current-head-audit.test.mjs'],
  'OP-01': ['components/bluewolf/operator-view.tsx', 'tests/op01-arena-presentation.test.mjs'],
  'OP-02': ['components/bluewolf/operational-live-map.tsx', 'tests/op02-map-layers.test.mjs', '.github/workflows/op02-map.yml'],
  'OP-03': ['components/bluewolf/operator-view.tsx', 'lib/speed-units.ts', 'tests/operator-speed-ui.test.mjs', '.github/workflows/op03-speed.yml'],
  'OP-04': ['components/bluewolf/operator-view.tsx', 'core/src/bluewolf_core/event_recompute.py', 'tests/op04-template-recompute-ui.test.mjs', 'core/tests/test_event_recompute.py'],
  'OP-05': ['components/bluewolf/operational-timeline.tsx', 'tests/op05-timeline-visibility.test.mjs', 'tests/op05-timeline-window.test.mjs'],
};

const SOURCE_STATUS_ORDER = ['yes', 'partial', 'no', 'unspecified'];

function sourceStatusMap(registry) {
  const output = new Map();
  for (const status of SOURCE_STATUS_ORDER) {
    for (const id of registry.sourceImplementation?.[status] ?? []) output.set(id, status);
  }
  return output;
}

function familyFor(id) {
  if (id.startsWith('BW-')) return id.split('-').slice(0, 2).join('-');
  return id.split('-')[0];
}

function baselineReview(id) {
  const family = familyFor(id);
  return FAMILY_REVIEW[family] ?? LATE_REVIEW[family] ?? {
    implementationLocation: ['Explicit audit gap: no family implementation location catalogued yet'],
    acceptanceEvidence: ['Explicit audit gap: no family acceptance evidence catalogued yet'],
  };
}

function splitEvidence(entries, baseline) {
  const implementationLocation = entries.filter((entry) => !entry.startsWith('tests/') && !entry.startsWith('core/tests/') && !entry.startsWith('.github/workflows/') && !entry.startsWith('scripts/verify_'));
  const acceptanceEvidence = entries.filter((entry) => !implementationLocation.includes(entry));
  return {
    implementationLocation: implementationLocation.length ? implementationLocation : baseline.implementationLocation,
    acceptanceEvidence: acceptanceEvidence.length ? acceptanceEvidence : baseline.acceptanceEvidence,
  };
}

export function buildCurrentHeadAudit(registry, { headSha = 'working-tree', reviewedAt = new Date().toISOString() } = {}) {
  const expected = expandExpectedIds(registry);
  const statuses = sourceStatusMap(registry);
  const requirements = {};

  for (const id of expected) {
    const sourceStatus = statuses.get(id) ?? 'unspecified';
    const baseline = baselineReview(id);
    const explicit = VERIFIED[id];

    if (explicit) {
      const evidence = splitEvidence(explicit, baseline);
      if (MANUAL_REVERIFY_REQUIRED.has(id)) {
        requirements[id] = {
          implementation: 'partial',
          verified: false,
          reviewedAtHead: headSha,
          reviewedAt,
          ...evidence,
          gap: id === 'BW-SYNC-013'
            ? 'Display-only smoothing is implemented consistently across timeline, current group cards and historical cursor while raw Core scores remain unchanged; this requirement stays partial until explicit user visual re-verification.'
            : 'Automated fix evidence exists, but this requirement remains partial until the user re-verifies the previously failed manual QA behavior.',
        };
      } else {
        requirements[id] = {
          implementation: 'yes',
          verified: true,
          reviewedAtHead: headSha,
          reviewedAt,
          ...evidence,
        };
      }
      continue;
    }

    const implementation = sourceStatus === 'no' ? 'no' : 'partial';
    const gap = sourceStatus === 'yes'
      ? 'Source document historically marks this implemented, but no explicit current-head verification override has been recorded yet.'
      : sourceStatus === 'partial'
        ? 'Implementation remains partial pending dedicated current-head acceptance closure.'
        : sourceStatus === 'no'
          ? 'Source document marks this not implemented; no current-head evidence supports promotion.'
          : 'Source document did not provide a conclusive implementation status; current-head acceptance remains open.';
    requirements[id] = {
      implementation,
      verified: false,
      reviewedAtHead: headSha,
      reviewedAt,
      implementationLocation: baseline.implementationLocation,
      acceptanceEvidence: baseline.acceptanceEvidence,
      gap,
    };
  }

  return {
    schemaVersion: CURRENT_HEAD_AUDIT_SCHEMA_VERSION,
    headSha,
    reviewedAt,
    requirementCount: expected.length,
    policy: 'Conservative current-head review: only explicit implementation/test overrides are eligible for yes; requirements that failed manual QA remain partial until user re-verification, and user implementation approval remains a separate release gate.',
    requirements,
  };
}

export async function buildCurrentHeadAuditFile(registryPath, outputPath, options = {}) {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const audit = buildCurrentHeadAudit(registry, options);
  await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  return audit;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const registryPath = path.resolve(process.argv[2] || 'docs/full-requirements-registry.json');
  const outputPath = path.resolve(process.argv[3] || 'build/current-head-requirements-audit.json');
  const headArg = process.argv.indexOf('--head');
  const headSha = headArg >= 0 && process.argv[headArg + 1]
    ? process.argv[headArg + 1]
    : process.env.BLUEWOLF_AUDIT_HEAD || process.env.GITHUB_SHA || 'working-tree';
  try {
    const audit = await buildCurrentHeadAuditFile(registryPath, outputPath, { headSha });
    const yes = Object.values(audit.requirements).filter((row) => row.implementation === 'yes').length;
    const partial = Object.values(audit.requirements).filter((row) => row.implementation === 'partial').length;
    const no = Object.values(audit.requirements).filter((row) => row.implementation === 'no').length;
    console.log(`AUDIT BUILT: ${audit.requirementCount} rows · yes=${yes} partial=${partial} no=${no} · head=${headSha}`);
  } catch (error) {
    console.error(`AUDIT BUILD FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
