import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('authenticated full-stack QA preview is restricted to the trusted owner branch and never PR code', async () => {
  const yaml = await readFile('.github/workflows/qa-quick-tunnel.yml', 'utf8');
  assert.match(yaml, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.match(yaml, /^\s+push:\s*$/m);
  assert.doesNotMatch(yaml, /^\s*(pull_request|pull_request_target|schedule):/m);
  assert.match(yaml, /github\.actor == 'roeemeir'/);
  assert.match(yaml, /github\.ref == 'refs\/heads\/work\/requirements-governance-2026-09-15'/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /test_token="\$\(openssl rand -hex 32\)"/);
  assert.match(yaml, /::add-mask::\$test_token/);
  assert.match(yaml, /BLUEWOLF_INFLUX_TOKEN=\$test_token/);
  assert.doesNotMatch(yaml, /\$\{\{\s*secrets\./);
  assert.match(yaml, /qa-basic-auth-proxy\.mjs/);
  assert.match(yaml, /cloudflared tunnel --no-autoupdate --url http:\/\/127\.0\.0\.1:8787/);
  assert.match(yaml, /curl --fail --silent --show-error -u "\$BLUEWOLF_QA_USER:\$BLUEWOLF_QA_PASS"/);
  assert.doesNotMatch(yaml, /actions\/upload-artifact/);
});
