import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ACTIVE_CORE_RESEARCH,
  ARCHIVED_CORE_RESEARCH,
  DOCUMENTATION_SYNC_SCHEMA_VERSION,
  IMPLEMENTATION_TRACKED_PATHS,
  validateDocumentationSync,
} from '../scripts/verify-documentation-sync.mjs';

test('BW-GOV-010 documentation sync fingerprint matches the current implementation tree', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  assert.equal(manifest.schemaVersion, DOCUMENTATION_SYNC_SCHEMA_VERSION);
  const result = await validateDocumentationSync(manifest);
  assert.deepEqual(result.errors, []);
  assert.equal(result.actual.digest, manifest.implementationFingerprint.digest);
  assert.equal(result.actual.fileCount, manifest.implementationFingerprint.fileCount);
  assert.deepEqual(manifest.implementationFingerprint.trackedPaths, IMPLEMENTATION_TRACKED_PATHS);
});

test('BW-GOV-010 manifest binds the governed Master and research documents to the verified implementation baseline', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  assert.equal(manifest.masterDocument.driveFileId, '1pcjq50LchceDYsCqek_jqxkkRYbnef4l');
  assert.equal(manifest.masterDocument.version, '2.8');
  assert.equal(manifest.implementationFingerprint.digest, 'c7e1c6a5ea4c2a2b');
  assert.equal(manifest.implementationFingerprint.fileCount, 272);
  assert.equal(manifest.masterDocument.verifiedImplementationBaseline, '2ec209e01f9ec02ff78ca239f2d69d5bc235378c');
  assert.equal(manifest.masterDocument.verifiedCiRun, 2967);
  assert.deepEqual(
    { version: manifest.coreResearchDocument.version, title: manifest.coreResearchDocument.title, driveFileId: manifest.coreResearchDocument.driveFileId },
    ACTIVE_CORE_RESEARCH,
  );
  assert.equal(manifest.archivedCoreResearchDocument.version, ARCHIVED_CORE_RESEARCH.version);
  assert.equal(manifest.archivedCoreResearchDocument.driveFileId, ARCHIVED_CORE_RESEARCH.driveFileId);
  assert.equal(manifest.archivedCoreResearchDocument.archiveFolderId, ARCHIVED_CORE_RESEARCH.archiveFolderId);
  assert.equal(manifest.archivedCoreResearchDocument.status, 'archived');
  assert.ok(manifest.researchDocuments.includes('core/docs/ALGORITHMIC_CORE_RESEARCH_LOG_HE.md'));
  assert.ok(manifest.researchDocuments.includes('core/docs/IMPLEMENTATION_STATUS_HE.md'));
});

test('BW-GOV-010 drift is fail-closed', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  const drifted = structuredClone(manifest);
  drifted.implementationFingerprint.digest = '0000000000000000';
  const result = await validateDocumentationSync(drifted);
  assert.ok(result.errors.some((error) => error.includes('documentation drift')));
});

test('BW-GOV-010 cannot silently restore archived v2.1 as the active Core report', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  const wrong = structuredClone(manifest);
  wrong.coreResearchDocument.version = '2.1';
  wrong.coreResearchDocument.title = 'Blue_Wolf_Core_Research_Report_HE_v2_1.docx';
  wrong.coreResearchDocument.driveFileId = ARCHIVED_CORE_RESEARCH.driveFileId;
  const result = await validateDocumentationSync(wrong);
  assert.ok(result.errors.some((error) => error.includes('canonical Drive report v1.2')));
  assert.ok(result.errors.some((error) => error.includes('cannot be the archived report')));
});

test('BW-GOV-010 missing archive metadata cannot masquerade as a synchronized report', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  const wrong = structuredClone(manifest);
  delete wrong.archivedCoreResearchDocument;
  const result = await validateDocumentationSync(wrong);
  assert.ok(result.errors.some((error) => error.includes('must remain explicitly archived')));
});
