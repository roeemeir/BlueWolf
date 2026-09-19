import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { validateDevelopmentIterationReview } from '../scripts/verify-development-iteration.mjs';

const registry = JSON.parse(await readFile('docs/full-requirements-registry.json', 'utf8'));
const review = JSON.parse(await readFile('docs/development-iteration-review.json', 'utf8'));

test('BW-GOV-007 current iteration review covers the whole registry and keeps manual-only backlog out of engineering selection', () => {
  assert.deepEqual(validateDevelopmentIterationReview(review, registry), []);
  assert.equal(review.requirementCount, registry.requirementCount);
  assert.equal(review.selectedForWork.length, 0);
  assert.deepEqual([...review.openRequirements].sort(), [...review.manualReverifyRequired].sort());
});

test('BW-GOV-007 requires engineering selection when a non-manual open requirement remains', () => {
  const broken = structuredClone(review);
  broken.manualReverifyRequired = broken.manualReverifyRequired.slice(1);
  const errors = validateDevelopmentIterationReview(broken, registry);
  assert.ok(errors.some((item) => item.includes('non-manual open requirements remain')));
});

test('BW-GOV-007 prevents manual re-verification work from being selected as engineering work', () => {
  const broken = structuredClone(review);
  broken.selectedForWork.push(review.manualReverifyRequired[0]);
  const errors = validateDevelopmentIterationReview(broken, registry);
  assert.ok(errors.some((item) => item.includes('manual re-verification requirement')));
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
