import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandExpectedIds } from './verify-full-requirements-registry.mjs';

const SHA40 = /^[0-9a-f]{40}$/;

function unique(values) {
  return Array.isArray(values) ? new Set(values) : null;
}

function sameMembers(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export function validateDevelopmentIterationReview(review, registry) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['development iteration review must be an object'];
  if (review.schemaVersion !== 'bluewolf.development-iteration-review.v1') errors.push('unsupported development iteration review schemaVersion');
  if (typeof review.iterationId !== 'string' || !review.iterationId.trim()) errors.push('iterationId is required');
  if (typeof review.branch !== 'string' || !review.branch.trim()) errors.push('branch is required');
  if (typeof review.baselineHead !== 'string' || !SHA40.test(review.baselineHead)) errors.push('baselineHead must be a 40-character git SHA');
  if (typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt))) errors.push('reviewedAt must be an ISO timestamp');

  const expected = expandExpectedIds(registry);
  if (review.requirementCount !== expected.length) errors.push(`requirementCount=${review.requirementCount} but registry expects ${expected.length}`);

  const protectedSet = unique(review.protectedRequirements);
  const openSet = unique(review.openRequirements);
  const selectedSet = unique(review.selectedForWork);
  const manualSet = unique(review.manualReverifyRequired);
  for (const [name, set] of [['protectedRequirements', protectedSet], ['openRequirements', openSet], ['selectedForWork', selectedSet], ['manualReverifyRequired', manualSet]]) {
    if (!set) errors.push(`${name} must be an array`);
  }
  if (!protectedSet || !openSet || !selectedSet || !manualSet) return errors;

  if (protectedSet.size !== review.protectedRequirements.length) errors.push('protectedRequirements contains duplicates');
  if (openSet.size !== review.openRequirements.length) errors.push('openRequirements contains duplicates');
  if (selectedSet.size !== review.selectedForWork.length) errors.push('selectedForWork contains duplicates');
  if (manualSet.size !== review.manualReverifyRequired.length) errors.push('manualReverifyRequired contains duplicates');

  const expectedSet = new Set(expected);
  for (const id of [...protectedSet, ...openSet, ...selectedSet, ...manualSet]) {
    if (!expectedSet.has(id)) errors.push(`unknown requirement id in iteration review: ${id}`);
  }
  for (const id of protectedSet) if (openSet.has(id)) errors.push(`${id} appears in both protected and open sets`);
  const covered = new Set([...protectedSet, ...openSet]);
  if (!sameMembers(covered, expectedSet)) errors.push('protectedRequirements + openRequirements must cover the complete registry exactly once');

  const sourceYes = new Set(registry.sourceImplementation?.yes ?? []);
  const sourceOpen = new Set(expected.filter((id) => !sourceYes.has(id)));
  if (!sameMembers(protectedSet, sourceYes)) errors.push('protectedRequirements must exactly match current sourceImplementation.yes');
  if (!sameMembers(openSet, sourceOpen)) errors.push('openRequirements must exactly match all current non-yes source statuses');

  for (const id of selectedSet) if (!openSet.has(id)) errors.push(`selectedForWork contains protected/non-open requirement: ${id}`);
  for (const id of manualSet) if (!openSet.has(id)) errors.push(`manualReverifyRequired contains protected/non-open requirement: ${id}`);
  if (openSet.size > 0 && selectedSet.size === 0) errors.push('selectedForWork must not be empty while open requirements remain');

  return errors;
}

export async function verifyDevelopmentIterationFiles(reviewPath, registryPath) {
  const [review, registry] = await Promise.all([
    readFile(reviewPath, 'utf8').then(JSON.parse),
    readFile(registryPath, 'utf8').then(JSON.parse),
  ]);
  return validateDevelopmentIterationReview(review, registry);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const reviewPath = path.resolve(process.argv[2] || 'docs/development-iteration-review.json');
  const registryPath = path.resolve(process.argv[3] || 'docs/full-requirements-registry.json');
  try {
    const errors = await verifyDevelopmentIterationFiles(reviewPath, registryPath);
    if (errors.length) {
      console.error('DEVELOPMENT ITERATION REVIEW BLOCKED:');
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log('PASS: full development iteration review covers all requirements and protects implemented requirements.');
    }
  } catch (error) {
    console.error(`DEVELOPMENT ITERATION REVIEW BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
