import assert from 'node:assert/strict';
import test from 'node:test';

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
