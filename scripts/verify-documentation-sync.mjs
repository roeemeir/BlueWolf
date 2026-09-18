import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

export const DOCUMENTATION_SYNC_SCHEMA_VERSION = 'bluewolf.documentation-sync.v1';
export const IMPLEMENTATION_TRACKED_PATHS = [
  'app/',
  'components/',
  'lib/',
  'core/src/',
  'deploy/',
  'package.json',
  'next.config.ts',
];

function implementationRows() {
  const output = execFileSync(
    'git',
    ['ls-files', '-s', '--', ...IMPLEMENTATION_TRACKED_PATHS],
    { encoding: 'utf8' },
  );
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+\s+([0-9a-f]{40,64})\s+\d+\t(.+)$/);
      if (!match) throw new Error(`cannot parse git index row: ${line}`);
      return { sha: match[1], path: match[2] };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function fnv1a64Ascii(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) throw new Error('documentation fingerprint input must remain ASCII');
    hash ^= BigInt(code);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

export function computeImplementationFingerprint() {
  const rows = implementationRows();
  const payload = rows.map(({ path, sha }) => `${path}\0${sha}\n`).join('');
  return {
    algorithm: 'fnv1a64(path\\0gitBlobSha\\n)',
    digest: fnv1a64Ascii(payload).toString(16).padStart(16, '0'),
    fileCount: rows.length,
    paths: rows.map((row) => row.path),
  };
}

export async function validateDocumentationSync(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== DOCUMENTATION_SYNC_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DOCUMENTATION_SYNC_SCHEMA_VERSION}`);
  }
  const actual = computeImplementationFingerprint();
  const expected = manifest?.implementationFingerprint ?? {};
  if (expected.algorithm !== actual.algorithm) errors.push('implementation fingerprint algorithm mismatch');
  if (expected.digest !== actual.digest) {
    errors.push(`implementation documentation drift: expected ${expected.digest ?? 'missing'}, current ${actual.digest}`);
  }
  if (expected.fileCount !== actual.fileCount) {
    errors.push(`implementation file count drift: expected ${expected.fileCount ?? 'missing'}, current ${actual.fileCount}`);
  }
  if (!Array.isArray(expected.trackedPaths) || JSON.stringify(expected.trackedPaths) !== JSON.stringify(IMPLEMENTATION_TRACKED_PATHS)) {
    errors.push('tracked implementation paths mismatch');
  }

  const master = manifest?.masterDocument ?? {};
  if (!/^[A-Za-z0-9_-]{20,}$/.test(master.driveFileId ?? '')) errors.push('master Drive file id missing');
  if (master.version !== '2.8') errors.push('master specification version must be 2.8');
  if (!/^[0-9a-f]{40}$/.test(master.verifiedImplementationBaseline ?? '')) errors.push('verified implementation baseline missing');
  if (!Number.isInteger(master.verifiedCiRun) || master.verifiedCiRun <= 0) errors.push('verified CI run missing');

  const research = manifest?.researchDocuments;
  if (!Array.isArray(research) || research.length < 2) errors.push('research document list missing');
  else {
    for (const file of research) {
      try { await access(file); } catch { errors.push(`missing research document: ${file}`); }
    }
  }
  return { errors, actual };
}

async function main() {
  const manifestPath = process.argv[2] ?? 'docs/documentation-sync.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { errors, actual } = await validateDocumentationSync(manifest);
  if (errors.length) {
    for (const error of errors) console.error(`documentation-sync: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`documentation-sync: OK ${actual.digest} (${actual.fileCount} implementation files)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
