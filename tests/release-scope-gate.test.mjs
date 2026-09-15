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

test('release gate blocks pending frozen requirement', () => {
  const errors = validateReleaseScope(manifest([requirement({ implementation: 'pending' })]));
  assert.ok(errors.some((item) => item.includes('blocks release: implementation=pending')));
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
