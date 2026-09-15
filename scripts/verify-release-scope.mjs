import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_IMPLEMENTATION = new Set(['yes', 'partial', 'no', 'pending']);
const VALID_IMPLEMENTATION_APPROVAL = new Set(['pending', 'approved']);
const LATE_REQUIREMENT_PREFIXES = ['GEO', 'SI', 'SO', 'UI', 'REP', 'IN', 'BANK', 'TEST', 'ARCH', 'PROC', 'CFG'];
const REQUIREMENT_ID_PATTERN = new RegExp(`^(?:BW-[A-Z]+-\\d{3}|(?:${LATE_REQUIREMENT_PREFIXES.join('|')})-\\d{2})$`);

export function validateReleaseScope(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['release scope must be an object'];
  }
  if (manifest.schemaVersion !== 'bluewolf.release-scope.v2') errors.push('unsupported release scope schemaVersion');
  if (typeof manifest.scopeId !== 'string' || !manifest.scopeId.trim()) errors.push('scopeId is required');
  if (manifest.scopeApprovedByUser !== true) errors.push('release scope itself is not marked scope-approved by user');
  if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
    errors.push('release scope must contain at least one requirement');
    return errors;
  }

  const ids = new Set();
  for (const [index, requirement] of manifest.requirements.entries()) {
    const prefix = `requirements[${index}]`;
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const id = typeof requirement.id === 'string' ? requirement.id.trim() : '';
    if (!REQUIREMENT_ID_PATTERN.test(id)) errors.push(`${prefix}.id is invalid`);
    if (ids.has(id)) errors.push(`duplicate requirement id: ${id}`);
    ids.add(id);
    if (requirement.frozen !== true) errors.push(`${id || prefix} is not marked frozen`);
    if (!VALID_IMPLEMENTATION.has(requirement.implementation)) errors.push(`${id || prefix} has invalid implementation status`);
    if (!VALID_IMPLEMENTATION_APPROVAL.has(requirement.implementationApproval)) {
      errors.push(`${id || prefix} has invalid implementation approval status`);
    }
    if (requirement.implementation !== 'yes') {
      errors.push(`${id || prefix} blocks release: implementation=${requirement.implementation}`);
    } else if (requirement.implementationApproval !== 'approved') {
      errors.push(`${id || prefix} blocks release: implementation approval is pending`);
    }
    if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) errors.push(`${id || prefix} is missing implementation evidence`);
  }
  return errors;
}

export async function verifyEvidencePaths(manifest, root = process.cwd()) {
  const errors = [];
  for (const requirement of manifest.requirements ?? []) {
    if (!Array.isArray(requirement?.evidence)) continue;
    for (const evidence of requirement.evidence) {
      if (typeof evidence !== 'string' || !evidence.trim()) {
        errors.push(`${requirement.id}: evidence entry must be a non-empty path`);
        continue;
      }
      const resolved = path.resolve(root, evidence);
      if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
        errors.push(`${requirement.id}: evidence path escapes repository: ${evidence}`);
        continue;
      }
      try { await access(resolved); } catch { errors.push(`${requirement.id}: evidence path does not exist: ${evidence}`); }
    }
  }
  return errors;
}

export async function verifyReleaseScopeFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const manifest = JSON.parse(content);
  return [...validateReleaseScope(manifest), ...await verifyEvidencePaths(manifest)];
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const manifestPath = path.resolve(process.argv[2] || 'docs/release-scope-2026-09-15.json');
  try {
    const errors = await verifyReleaseScopeFile(manifestPath);
    if (errors.length) {
      console.error('RELEASE BLOCKED — frozen requirements are not fully implemented/evidenced/signed-off:');
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: release scope ${manifestPath} is scope-approved and contains only frozen, implemented, evidenced, user-signed-off requirements.`);
    }
  } catch (error) {
    console.error(`RELEASE BLOCKED — cannot verify release scope: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
