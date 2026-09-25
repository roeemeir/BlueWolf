import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/qa-quick-tunnel.yml', 'utf8');
const factory = await readFile('core/src/bluewolf_runtime_adapter/environment_factory.py', 'utf8');

function stepPosition(name) {
  const at = workflow.indexOf(`- name: ${name}`);
  assert.ok(at >= 0, `missing E2E step: ${name}`);
  return at;
}

test('E2E actually initializes the same SQLite file used by Web and operational Python Core', () => {
  assert.match(workflow, /BLUEWOLF_SQLITE_PATH: \$\{\{ github\.workspace \}\}\/data\/qa-e2e\.sqlite/);
  assert.match(workflow, /BLUEWOLF_WORKSPACE_DB: \$\{\{ github\.workspace \}\}\/data\/qa-e2e\.sqlite/);
  assert.match(factory, /os\.environ\.get\("BLUEWOLF_WORKSPACE_DB"/);
  assert.match(factory, /SELECT state FROM workspaces WHERE id='installation'/);
  assert.ok(stepPosition('Start SQLite-backed Web server before Core reads its database') < stepPosition('Commit the exact E2E Influx join schema to SQLite before Core boot'));
  assert.ok(stepPosition('Commit the exact E2E Influx join schema to SQLite before Core boot') < stepPosition('Start actual operational Python Core connected to the saved SQLite schema'));
  assert.ok(stepPosition('Start actual operational Python Core connected to the saved SQLite schema') < stepPosition('Check operational Core feed and three servers through Web plus SQLite round trip'));
  assert.match(workflow, /assert\.deepEqual\(verify\.state\.influx\.stream, state\.influx\.stream\)/);
  assert.match(workflow, /state\.influx\.token = ''/);
});

test('E2E private integration does not publish a browser-only or Core-less testing URL', () => {
  assert.doesNotMatch(workflow, /cloudflared|trycloudflare\.com|upload-artifact|tunnel_url|quick-tunnel-url/i);
  assert.match(workflow, /No tunnel, preview artifact or public link is created/);
  assert.match(workflow, /BLUEWOLF_E2E_OPERATIONAL_CONFIG_JSON/);
  assert.match(workflow, /three-server E2E config and Influx token are required/);
});
