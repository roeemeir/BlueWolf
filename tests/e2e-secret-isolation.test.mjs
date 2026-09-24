import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('secret-backed Influx/Core integration is owner-dispatched on trusted branch, never automatic PR code', async () => {
  const yaml = await readFile('.github/workflows/qa-quick-tunnel.yml', 'utf8');
  assert.match(yaml, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(yaml, /^\s*(pull_request|pull_request_target|push|schedule):/m);
  assert.match(yaml, /github\.event_name == 'workflow_dispatch'/);
  assert.match(yaml, /github\.actor == 'roeemeir'/);
  assert.match(yaml, /github\.ref == 'refs\/heads\/work\/requirements-governance-2026-09-15'/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /BLUEWOLF_E2E_INFLUX_TOKEN/);
  assert.match(yaml, /BLUEWOLF_E2E_OPERATIONAL_CONFIG_JSON/);
  assert.doesNotMatch(yaml, /\bcloudflared\b|actions\/upload-artifact|Publish QA URL artifact/i);
});
