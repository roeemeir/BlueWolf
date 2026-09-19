import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFullRegistry } from '../scripts/verify-full-requirements-registry.mjs';
import { validateReleaseScope, verifyEvidencePaths } from '../scripts/verify-release-scope.mjs';

function requirement(overrides = {}) {
  return {
    id: 'BW-QA-007',
    frozen: true,
    implementation: 'yes',
    implementationApproval: 'approved',
    evidence: ['package.json'],
    ...overrides,
  };
}

function manifest(requirements, overrides = {}) {
  return {
    schemaVersion: 'bluewolf.release-scope.v2',
    scopeId: 'test-scope',
    scopeApprovedByUser: true,
    requirements,
    ...overrides,
  };
}

function registryWithUnspecifiedSource(auditRequirements = {}) {
  return {
    schemaVersion: 'bluewolf.full-requirements-registry.v1',
    requirementCount: 1,
    idFamilies: [{ prefix: 'BW-OP', first: 1, last: 1, width: 3 }],
    lateBindingIds: [],
    sourceImplementation: { yes: [], partial: [], no: [], unspecified: ['BW-OP-001'] },
    sourceImplementationApproval: { unspecified: ['BW-OP-001'] },
    explicitAcceptanceCriteria: {},
    audit: { requirements: auditRequirements },
  };
}

test('release gate accepts only fully implemented, frozen, evidenced and implementation-approved scope', async () => {
  const value = manifest([requirement()]);
  assert.deepEqual(validateReleaseScope(value), []);
  assert.deepEqual(await verifyEvidencePaths(value), []);
});

test('scope approval and implementation approval are distinct', () => {
  const scopeErrors = validateReleaseScope(manifest([requirement()], { scopeApprovedByUser: false }));
  assert.ok(scopeErrors.some((item) => item.includes('scope-approved')));

  const implementationErrors = validateReleaseScope(manifest([requirement({ implementationApproval: 'pending' })]));
  assert.ok(implementationErrors.some((item) => item.includes('implementation approval is pending')));
});

test('release gate accepts an approved late requirement id when it is fully implemented', () => {
  const errors = validateReleaseScope(manifest([requirement({ id: 'GEO-01' })]));
  assert.deepEqual(errors, []);
});

test('release gate accepts CFG late requirement ids but rejects unknown prefixes', () => {
  assert.deepEqual(validateReleaseScope(manifest([requirement({ id: 'CFG-01' })])), []);
  const errors = validateReleaseScope(manifest([requirement({ id: 'FAKE-01' })]));
  assert.ok(errors.some((item) => item.includes('id is invalid')));
});

test('release gate blocks pending frozen requirement without conflating it with user sign-off', () => {
  const bwErrors = validateReleaseScope(manifest([requirement({ implementation: 'pending', implementationApproval: 'pending' })]));
  assert.ok(bwErrors.some((item) => item.includes('blocks release: implementation=pending')));
  assert.ok(!bwErrors.some((item) => item.includes('implementation approval is pending')));

  const lateErrors = validateReleaseScope(manifest([requirement({ id: 'REP-01', implementation: 'pending', implementationApproval: 'pending' })]));
  assert.ok(lateErrors.some((item) => item.includes('REP-01 blocks release: implementation=pending')));
});

test('release gate blocks duplicate ids, invalid approval status and missing evidence', () => {
  const errors = validateReleaseScope(manifest([
    requirement({ implementationApproval: 'not-reviewed', evidence: [] }),
    requirement(),
  ]));
  assert.ok(errors.some((item) => item.includes('duplicate requirement id')));
  assert.ok(errors.some((item) => item.includes('invalid implementation approval status')));
  assert.ok(errors.some((item) => item.includes('missing implementation evidence')));
});

test('release gate rejects missing repository evidence path', async () => {
  const errors = await verifyEvidencePaths(manifest([requirement({ evidence: ['does-not-exist.release-evidence'] })]));
  assert.ok(errors.some((item) => item.includes('evidence path does not exist')));
});

test('full-registry release audit lets a current-head audit resolve an unspecified historical source status', () => {
  const registry = registryWithUnspecifiedSource({
    'BW-OP-001': {
      implementation: 'yes',
      reviewedAtHead: 'abc123',
      implementationLocation: ['components/bluewolf/operator-view.tsx'],
      acceptanceEvidence: ['tests/op01-arena-presentation.test.mjs'],
      verified: true,
    },
  });
  const result = validateFullRegistry(registry, null, { strictRelease: true });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((item) => item.includes('source document lacks')));
});

test('full-registry release audit still blocks an unspecified source requirement when current-head audit is missing', () => {
  const result = validateFullRegistry(registryWithUnspecifiedSource(), null, { strictRelease: true });
  assert.ok(result.errors.some((item) => item.includes('missing current-head audit record')));
});
