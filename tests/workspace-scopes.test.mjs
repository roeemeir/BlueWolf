import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'bw-scoped-settings-'));
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = join(dir, 'workspace.sqlite');
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });
const route = await vite.ssrLoadModule('/app/api/workspace/scope/route.ts');

function put(scopeType, scopeId, state, expectedRevision) {
  return route.PUT(new Request('http://bluewolf.local/api/workspace/scope', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scopeType, scopeId, state, expectedRevision, category: 'operator', action: 'scope-test', detail: `${scopeType}:${scopeId}` }),
  }));
}

function get(scopeType, scopeId) {
  return route.GET(new Request(`http://bluewolf.local/api/workspace/scope?type=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`));
}

test('BW-OFF-011 server-wide and per-group settings have independent revisions and cannot clobber each other', async () => {
  const serverWrite = await put('server', '1', { arena: 'Arena North', mapProfile: 'map-private' }, 0);
  assert.equal(serverWrite.status, 200);
  assert.equal((await serverWrite.json()).revision, 1);

  // The group starts from its own revision 0 even though the server scope is revision 1.
  const groupWrite = await put('group', '1:g-alpha', {
    activeTemplateId: 'tpl-so-a',
    templateApplication: { templateId: 'tpl-so-a', mode: 'now', appliedAt: '2026-09-16T10:00:00Z' },
  }, 0);
  assert.equal(groupWrite.status, 200);
  assert.equal((await groupWrite.json()).revision, 1);

  const secondServerWrite = await put('server', '1', { arena: 'Arena South', mapProfile: 'map-private' }, 1);
  assert.equal(secondServerWrite.status, 200);
  assert.equal((await secondServerWrite.json()).revision, 2);

  const serverRead = await get('server', '1');
  const groupRead = await get('group', '1:g-alpha');
  assert.equal(serverRead.status, 200);
  assert.equal(groupRead.status, 200);
  const server = await serverRead.json();
  const group = await groupRead.json();
  assert.equal(server.revision, 2);
  assert.deepEqual(server.state, { arena: 'Arena South', mapProfile: 'map-private' });
  assert.equal(group.revision, 1);
  assert.equal(group.state.activeTemplateId, 'tpl-so-a');
  assert.equal(group.state.templateApplication.mode, 'now');

  // A stale write conflicts only inside its own scope; it does not modify the other scope.
  const staleGroup = await put('group', '1:g-alpha', { activeTemplateId: 'tpl-other' }, 0);
  assert.equal(staleGroup.status, 409);
  const serverAfterConflict = await (await get('server', '1')).json();
  const groupAfterConflict = await (await get('group', '1:g-alpha')).json();
  assert.equal(serverAfterConflict.state.arena, 'Arena South');
  assert.equal(groupAfterConflict.state.activeTemplateId, 'tpl-so-a');
});

test('BW-OFF-011 rejects cross-scope fields instead of silently storing them', async () => {
  const serverWithGroupField = await put('server', '2', { activeTemplateId: 'tpl-nope' }, 0);
  assert.equal(serverWithGroupField.status, 400);
  const groupWithServerField = await put('group', '2:g1', { mapProfile: 'map-nope' }, 0);
  assert.equal(groupWithServerField.status, 400);
});
