import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  computeImplementationFingerprint,
  DOCUMENTATION_SYNC_SCHEMA_VERSION,
  IMPLEMENTATION_TRACKED_PATHS,
  validateDocumentationSync,
} from '../scripts/verify-documentation-sync.mjs';

test('BW-GOV-010 documentation sync fingerprint matches the current implementation tree', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  assert.equal(manifest.schemaVersion, DOCUMENTATION_SYNC_SCHEMA_VERSION);
  const result = await validateDocumentationSync(manifest);
  assert.deepEqual(result.errors, []);
  assert.equal(result.actual.digest, '2a1cf45a2e94af2e');
  assert.equal(result.actual.fileCount, 240);
  assert.deepEqual(manifest.implementationFingerprint.trackedPaths, IMPLEMENTATION_TRACKED_PATHS);
});

test('BW-GOV-010 manifest binds the governed Master and research documents to the verified implementation baseline', async () => {
  const manifest = JSON.parse(await readFile('docs/documentation-sync.json', 'utf8'));
  assert.equal(manifest.masterDocument.driveFileId, '1pcjq50LchceDYsCqek_jqxkkRYbnef4l');
  assert.equal(manifest.masterDocument.version, '2.8');
  assert.equal(manifest.masterDocument.verifiedImplementationBaseline, '8e859273560d61af09095352579f37a94c4d45b1');
  assert.equal(manifest.masterDocument.verifiedCiRun, 2203);
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
