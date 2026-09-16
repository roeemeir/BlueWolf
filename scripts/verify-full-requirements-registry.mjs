import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_STATUSES = ["yes", "partial", "no", "unspecified"];
const CURRENT_STATUSES = new Set(["yes", "partial", "no"]);
const EXTERNAL_AUDIT_SCHEMA_VERSION = "bluewolf.current-head-audit.v1";

export function expandExpectedIds(registry) {
  const ids = [];
  for (const family of registry.idFamilies ?? []) {
    if (!family || typeof family !== "object") continue;
    const prefix = String(family.prefix ?? "");
    const first = Number(family.first);
    const last = Number(family.last);
    const width = Number(family.width);
    if (!prefix || !Number.isInteger(first) || !Number.isInteger(last) || last < first || !Number.isInteger(width) || width < 1) continue;
    for (let value = first; value <= last; value += 1) ids.push(`${prefix}-${String(value).padStart(width, "0")}`);
  }
  for (const id of registry.lateBindingIds ?? []) ids.push(String(id));
  return ids;
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

export function validateExternalAuditEnvelope(auditEnvelope, registry, { expectedHead = null } = {}) {
  const errors = [];
  if (!auditEnvelope || typeof auditEnvelope !== "object" || Array.isArray(auditEnvelope)) return ["external audit must be an object"];
  if (auditEnvelope.schemaVersion !== EXTERNAL_AUDIT_SCHEMA_VERSION) errors.push("unsupported external audit schemaVersion");
  const expected = expandExpectedIds(registry);
  if (auditEnvelope.requirementCount !== expected.length) errors.push(`external audit requirementCount=${auditEnvelope.requirementCount} but registry expects ${expected.length}`);
  if (typeof auditEnvelope.headSha !== "string" || !auditEnvelope.headSha.trim()) errors.push("external audit headSha is required");
  if (expectedHead && auditEnvelope.headSha !== expectedHead) errors.push(`external audit headSha=${auditEnvelope.headSha} does not match expected head ${expectedHead}`);
  if (typeof auditEnvelope.reviewedAt !== "string" || !auditEnvelope.reviewedAt.trim()) errors.push("external audit reviewedAt is required");
  if (!auditEnvelope.requirements || typeof auditEnvelope.requirements !== "object" || Array.isArray(auditEnvelope.requirements)) errors.push("external audit requirements must be an object");
  return errors;
}

export function validateFullRegistry(registry, releaseScope = null, { strictRelease = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return { errors: ["full requirements registry must be an object"], warnings };
  if (registry.schemaVersion !== "bluewolf.full-requirements-registry.v1") errors.push("unsupported full requirements registry schemaVersion");

  const expected = expandExpectedIds(registry);
  const duplicateExpected = duplicates(expected);
  if (duplicateExpected.length) errors.push(`duplicate expected requirement ids: ${duplicateExpected.join(", ")}`);
  if (expected.length !== registry.requirementCount) errors.push(`requirementCount=${registry.requirementCount} but manifest expands to ${expected.length}`);
  const expectedSet = new Set(expected);

  const sourceMembership = new Map();
  for (const status of SOURCE_STATUSES) {
    const ids = registry.sourceImplementation?.[status];
    if (!Array.isArray(ids)) {
      errors.push(`sourceImplementation.${status} must be an array`);
      continue;
    }
    for (const id of ids) {
      if (!expectedSet.has(id)) errors.push(`sourceImplementation.${status} contains unknown id ${id}`);
      if (sourceMembership.has(id)) errors.push(`${id} appears in multiple source implementation buckets: ${sourceMembership.get(id)}, ${status}`);
      else sourceMembership.set(id, status);
    }
  }
  const missingSourceStatus = expected.filter((id) => !sourceMembership.has(id));
  if (missingSourceStatus.length) errors.push(`requirements missing source implementation status: ${missingSourceStatus.join(", ")}`);

  const approvalUnspecified = new Set(registry.sourceImplementationApproval?.unspecified ?? []);
  for (const id of approvalUnspecified) if (!expectedSet.has(id)) errors.push(`source approval unspecified contains unknown id ${id}`);

  const acceptance = registry.explicitAcceptanceCriteria ?? {};
  for (const [id, criterion] of Object.entries(acceptance)) {
    if (!expectedSet.has(id)) errors.push(`acceptance criteria contains unknown id ${id}`);
    if (typeof criterion !== "string" || !criterion.trim()) errors.push(`${id} has empty explicit acceptance criteria`);
  }

  const audit = registry.audit?.requirements;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) errors.push("audit.requirements must be an object");
  else {
    for (const id of Object.keys(audit)) if (!expectedSet.has(id)) errors.push(`audit contains unknown requirement id ${id}`);
  }

  if (releaseScope) {
    const scopedIds = new Set();
    for (const item of releaseScope.requirements ?? []) {
      const id = typeof item?.id === "string" ? item.id : "";
      if (!expectedSet.has(id)) errors.push(`release scope contains id missing from full registry: ${id || "<missing>"}`);
      if (scopedIds.has(id)) errors.push(`release scope duplicates id: ${id}`);
      scopedIds.add(id);
    }
  }

  const unspecified = expected.filter((id) => sourceMembership.get(id) === "unspecified" || approvalUnspecified.has(id));
  if (unspecified.length) warnings.push(`source document lacks implementation/approval status for: ${unspecified.join(", ")}`);

  if (strictRelease && audit && typeof audit === "object" && !Array.isArray(audit)) {
    // Source-document status is historical metadata. A complete current-head
    // audit is authoritative for engineering verification, while explicit user
    // implementation approval remains a separate release-scope gate.
    for (const id of expected) {
      const row = audit[id];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`${id}: missing current-head audit record`);
        continue;
      }
      if (!CURRENT_STATUSES.has(row.implementation)) errors.push(`${id}: current-head audit implementation must be yes/partial/no`);
      if (typeof row.reviewedAtHead !== "string" || !row.reviewedAtHead.trim()) errors.push(`${id}: reviewedAtHead is required`);
      if (!Array.isArray(row.implementationLocation) || row.implementationLocation.length === 0 || row.implementationLocation.some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`${id}: implementationLocation must contain at least one reviewed path/module or explicit gap record`);
      }
      if (!Array.isArray(row.acceptanceEvidence) || row.acceptanceEvidence.length === 0 || row.acceptanceEvidence.some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`${id}: acceptanceEvidence must contain at least one test/check or explicit gap record`);
      }
      if (row.implementation === "yes" && row.verified !== true) errors.push(`${id}: implementation=yes requires verified=true`);
      if (row.implementation !== "yes" && (typeof row.gap !== "string" || !row.gap.trim())) errors.push(`${id}: partial/no audit requires an explicit gap`);
    }
  }

  return { errors, warnings, expectedCount: expected.length, auditedCount: audit && typeof audit === "object" && !Array.isArray(audit) ? Object.keys(audit).length : 0 };
}

export async function verifyFullRegistryFiles(
  registryPath,
  releaseScopePath = null,
  { strictRelease = false, auditPath = null, expectedHead = null } = {},
) {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const releaseScope = releaseScopePath ? JSON.parse(await readFile(releaseScopePath, "utf8")) : null;
  const envelopeErrors = [];
  if (auditPath) {
    const auditEnvelope = JSON.parse(await readFile(auditPath, "utf8"));
    envelopeErrors.push(...validateExternalAuditEnvelope(auditEnvelope, registry, { expectedHead }));
    registry.audit = {
      ...(registry.audit ?? {}),
      externalSchemaVersion: auditEnvelope.schemaVersion,
      headSha: auditEnvelope.headSha,
      reviewedAt: auditEnvelope.reviewedAt,
      requirements: auditEnvelope.requirements ?? {},
    };
  }
  const result = validateFullRegistry(registry, releaseScope, { strictRelease });
  return { ...result, errors: [...envelopeErrors, ...result.errors] };
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const registryPath = path.resolve(process.argv[2] || "docs/full-requirements-registry.json");
  const releaseScopePath = path.resolve(process.argv[3] || "docs/release-scope-2026-09-15.json");
  const strictRelease = process.argv.includes("--release");
  const auditArg = flagValue("--audit");
  const expectedHead = flagValue("--head");
  const auditPath = auditArg ? path.resolve(auditArg) : null;
  try {
    const result = await verifyFullRegistryFiles(registryPath, releaseScopePath, { strictRelease, auditPath, expectedHead });
    for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
    if (result.errors.length) {
      console.error(`REQUIREMENTS COVERAGE BLOCKED — ${result.expectedCount ?? "?"} expected, ${result.auditedCount ?? 0} audited:`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: full requirements registry covers ${result.expectedCount} unique requirements; ${result.auditedCount} have current-head audit records${strictRelease ? " and release audit is complete" : ""}.`);
    }
  } catch (error) {
    console.error(`REQUIREMENTS COVERAGE BLOCKED — cannot verify full registry: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
