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
  assert.ok(stepPosition('Start SQLite-backed Web server before Core reads its database') < stepPosition('Commit exact E2E Influx join schema to SQLite before Core boot'));
  assert.ok(stepPosition('Commit exact E2E Influx join schema to SQLite before Core boot') < stepPosition('Start actual operational Python Core'));
  assert.ok(stepPosition('Start actual operational Python Core') < stepPosition('Verify actual InfluxDB2 TEST feed → Core → three servers → Web parity and SQLite'));
  assert.match(workflow, /state\.influx\.stream =/);
  assert.match(workflow, /state\.influx\.token = ''/);
  assert.match(workflow, /nohup setsid npm run start:offline/);
  assert.match(workflow, /nohup setsid bluewolf-runtime/);
  assert.match(workflow, /old Web\/Core listeners did not stop cleanly/);
});

test('authenticated preview is created only after full Core, archive, PDF, restart and governance gates', () => {
  const e2e = stepPosition('Verify event archive → recompute history → report data/PDF on all servers');
  const browser = stepPosition('Verify same full environment in desktop and iPhone Chromium');
  const restart = stepPosition('Restart Web and Core and prove persistence plus fresh source');
  const governance = stepPosition('Verify governance fingerprint before any URL can exist');
  const tunnel = stepPosition('Launch proxy and Cloudflare Quick Tunnel');
  const publicBrowser = stepPosition('Verify public authenticated path in Chromium');
  const accessArtifact = stepPosition('Upload private QA access artifact');
  const publish = stepPosition('Publish READY coordinates and keep verified QA environment alive');
  assert.ok(e2e < browser && browser < restart && restart < governance && governance < tunnel && tunnel < publicBrowser && publicBrowser < accessArtifact && accessArtifact < publish);
  assert.match(workflow, /BLUEWOLF_QA_USER=bluewolf/);
  assert.match(workflow, /BLUEWOLF_QA_PASS=\$\(openssl rand -hex 16\)/);
  assert.match(workflow, /grep -oE .*trycloudflare.*cloudflared\.log/);
  assert.match(workflow, /public_ready=0/);
  assert.match(workflow, /unauth_code=.*http_code/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days: 1/);
  assert.doesNotMatch(workflow, /echo "QA_PASSWORD=\$BLUEWOLF_QA_PASS"/);
  assert.match(workflow, /authenticated temporary QA preview; not production/);
});
