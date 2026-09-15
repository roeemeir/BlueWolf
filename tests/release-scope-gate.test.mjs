import assert from 'node:assert/strict';
import test from 'node:test';

import { validateReleaseScope, verifyEvidencePaths } from '../scripts/verify-release-scope.mjs';

function requirement(overrides = {}) {
  return {
    id: 'BW-QA-007',
    frozen: true,
    userApproved: true,
    implementation: 'yes',
    evidence: ['package.json'],
    ...overrides,
  };
}

function manifest(requirements) {
  return {
    schemaVersion: 'bluewolf.release-scope.v1',
    scopeId: 'test-scope',
    requirements,
  };
}

test('release gate accepts only fully implemented, frozen, approved and evidenced scope', async () => {
  const value = manifest([requirement()]);
  assert.deepEqual(validateReleaseScope(value), []);
  assert.deepEqual(await verifyEvidencePaths(value), []);
});

test('release gate accepts an approved late requirement id when it is fully implemented', () => {
  const errors = validateReleaseScope(manifest([requirement({ id: 'GEO-01' })]));
  assert.deepEqual(errors, []);
});

test('release gate blocks pending frozen requirement, including late requirements', () => {
  const bwErrors = validateReleaseScope(manifest([requirement({ implementation: 'pending' })]));
  assert.ok(bwErrors.some((item) => item.includes('blocks release: implementation=pending')));

  const lateErrors = validateReleaseScope(manifest([requirement({ id: 'REP-01', implementation: 'pending' })]));
  assert.ok(lateErrors.some((item) => item.includes('REP-01 blocks release: implementation=pending')));
});

test('release gate rejects unknown late requirement prefixes instead of accepting arbitrary ids', () => {
  const errors = validateReleaseScope(manifest([requirement({ id: 'FAKE-01' })]));
  assert.ok(errors.some((item) => item.includes('id is invalid')));
});

test('release gate blocks duplicate ids, missing approval and missing evidence', () => {
  const errors = validateReleaseScope(manifest([
    requirement({ userApproved: false, evidence: [] }),
    requirement(),
  ]));
  assert.ok(errors.some((item) => item.includes('duplicate requirement id')));
  assert.ok(errors.some((item) => item.includes('not marked user-approved')));
  assert.ok(errors.some((item) => item.includes('missing implementation evidence')));
});

test('release gate rejects missing repository evidence path', async () => {
  const errors = await verifyEvidencePaths(manifest([requirement({ evidence: ['does-not-exist.release-evidence'] })]));
  assert.ok(errors.some((item) => item.includes('evidence path does not exist')));
});
