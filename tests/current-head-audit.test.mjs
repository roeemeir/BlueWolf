import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildCurrentHeadAudit, CURRENT_HEAD_AUDIT_SCHEMA_VERSION } from '../scripts/build-current-head-audit.mjs';
import { validateExternalAuditEnvelope, validateFullRegistry, verifyAuditEvidencePaths } from '../scripts/verify-full-requirements-registry.mjs';

async function fixture() {
  const registry = JSON.parse(await readFile('docs/full-requirements-registry.json', 'utf8'));
  const releaseScope = JSON.parse(await readFile('docs/release-scope-2026-09-15.json', 'utf8'));
  return { registry, releaseScope };
}

test('PROC-01 builder produces one conservative current-head row for every registered requirement', async () => {
  const { registry } = await fixture();
  const audit = buildCurrentHeadAudit(registry, { headSha: 'test-head', reviewedAt: '2026-09-17T00:00:00.000Z' });
  assert.equal(audit.schemaVersion, CURRENT_HEAD_AUDIT_SCHEMA_VERSION);
  assert.equal(audit.headSha, 'test-head');
  assert.equal(audit.requirementCount, registry.requirementCount);
  assert.equal(Object.keys(audit.requirements).length, registry.requirementCount);
  for (const [id, row] of Object.entries(audit.requirements)) {
    assert.ok(['yes', 'partial', 'no'].includes(row.implementation), `${id}: status`);
    assert.equal(row.reviewedAtHead, 'test-head', `${id}: head`);
    assert.ok(Array.isArray(row.implementationLocation) && row.implementationLocation.length > 0, `${id}: implementationLocation`);
    assert.ok(Array.isArray(row.acceptanceEvidence) && row.acceptanceEvidence.length > 0, `${id}: acceptanceEvidence`);
    if (row.implementation === 'yes') assert.equal(row.verified, true, `${id}: yes must be verified`);
    else assert.equal(typeof row.gap, 'string', `${id}: partial/no requires gap`);
  }
  assert.deepEqual(await verifyAuditEvidencePaths(audit.requirements), []);
});

test('BW-DATA-010 is verified only with real InfluxDB2 end-to-end latency evidence', async () => {
  const { registry } = await fixture();
  assert.ok(registry.sourceImplementation.yes.includes('BW-DATA-010'));
  const audit = buildCurrentHeadAudit(registry, { headSha: 'test-head', reviewedAt: '2026-09-18T00:00:00.000Z' });
  const row = audit.requirements['BW-DATA-010'];
  assert.equal(row.implementation, 'yes');
  assert.equal(row.verified, true);
  assert.ok(row.acceptanceEvidence.includes('core/tests/test_latency_influx_e2e.py'));
  assert.ok(row.acceptanceEvidence.includes('.github/workflows/data10-latency.yml'));
  assert.deepEqual(await verifyAuditEvidencePaths({ 'BW-DATA-010': row }), []);
});

test('PROC-01 exact-head validation rejects a recycled audit from another commit', async () => {
  const { registry } = await fixture();
  const audit = buildCurrentHeadAudit(registry, { headSha: 'old-head', reviewedAt: '2026-09-17T00:00:00.000Z' });
  const errors = validateExternalAuditEnvelope(audit, registry, { expectedHead: 'new-head' });
  assert.ok(errors.some((message) => message.includes('does not match expected head')));
});

test('PROC-01 generated audit satisfies strict evidence structure without granting release approval', async () => {
  const { registry, releaseScope } = await fixture();
  const audit = buildCurrentHeadAudit(registry, { headSha: 'test-head', reviewedAt: '2026-09-17T00:00:00.000Z' });
  const withAudit = {
    ...registry,
    audit: { ...(registry.audit ?? {}), requirements: audit.requirements },
  };
  const result = validateFullRegistry(withAudit, releaseScope, { strictRelease: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.auditedCount, registry.requirementCount);
  assert.ok(Object.values(audit.requirements).some((row) => row.implementation !== 'yes'), 'audit must remain conservative');
  assert.ok(releaseScope.requirements.some((row) => row.implementationApproval === 'pending'), 'user implementation approval remains a separate gate');
});
