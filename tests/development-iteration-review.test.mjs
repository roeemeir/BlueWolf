import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { validateDevelopmentIterationReview } from '../scripts/verify-development-iteration.mjs';

const registry = JSON.parse(await readFile('docs/full-requirements-registry.json', 'utf8'));
const review = JSON.parse(await readFile('docs/development-iteration-review.json', 'utf8'));

test('BW-GOV-007 current iteration review covers the whole registry and selects only open work', () => {
  assert.deepEqual(validateDevelopmentIterationReview(review, registry), []);
  assert.equal(review.requirementCount, registry.requirementCount);
  assert.ok(review.selectedForWork.length > 0);
});

test('BW-GOV-007 blocks omission of an open requirement', () => {
  const broken = structuredClone(review);
  broken.openRequirements.pop();
  const errors = validateDevelopmentIterationReview(broken, registry);
  assert.ok(errors.some((item) => item.includes('cover the complete registry') || item.includes('openRequirements must exactly match')));
});

test('BW-GOV-007 blocks accidental selection of a protected requirement', () => {
  const broken = structuredClone(review);
  broken.selectedForWork.push(review.protectedRequirements[0]);
  const errors = validateDevelopmentIterationReview(broken, registry);
  assert.ok(errors.some((item) => item.includes('selectedForWork contains protected/non-open')));
});

test('BW-GOV-007 blocks silent downgrade of a protected requirement in the registry snapshot', () => {
  const changedRegistry = structuredClone(registry);
  const id = review.protectedRequirements[0];
  changedRegistry.sourceImplementation.yes = changedRegistry.sourceImplementation.yes.filter((value) => value !== id);
  changedRegistry.sourceImplementation.partial.push(id);
  const errors = validateDevelopmentIterationReview(review, changedRegistry);
  assert.ok(errors.some((item) => item.includes('protectedRequirements must exactly match')));
});
