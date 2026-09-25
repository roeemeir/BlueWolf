import assert from 'node:assert/strict';
import test, { after, beforeEach, afterEach } from 'node:test';
import React from 'react';
import { createServer } from 'vite';

// Execute the real map component and its effects with controlled runtime input.
// This checks rendered SVG elements, not source-text patterns or browser layout.
const root = process.cwd();
const harness = { states: [], effects: [], pending: [], index: 0, effectIndex: 0, groups: [], trace: [], history: [] };
globalThis.__bluewolfMapTest = harness;
globalThis.React = React;
harness.useState = (initial) => {
  const index = harness.index++;
  if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial;
  return [harness.states[index], (value) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value; }];
};
harness.useEffect = (effect, deps) => {
  const index = harness.effectIndex++;
  const previous = harness.effects[index];
  if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
    harness.pending.push(() => {
      previous?.cleanup?.();
      harness.effects[index] = { deps, cleanup: effect() };
    });
  }
};
const vite = await createServer({
  appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false },
  plugins: [{ name: 'controlled-map-runtime', enforce: 'pre', transform(source, id) {
    if (!id.endsWith('/components/bluewolf/operational-live-map.tsx')) return;
    return source
      .replace('import { useEffect, useState } from "react";', 'const { useEffect, useState } = globalThis.__bluewolfMapTest;')
      .replace(/import \{ getRuntimeGroups, getRuntimeTrace, type LiveRuntimeVehicle \} from "@\/lib\/live-runtime";/, 'const getRuntimeGroups = () => globalThis.__bluewolfMapTest.groups; const getRuntimeTrace = () => globalThis.__bluewolfMapTest.trace;')
      .replace('import { getLiveRuntimeHistory } from "@/lib/live-runtime-history";', 'const getLiveRuntimeHistory = () => globalThis.__bluewolfMapTest.history;')
      // The actual WorkspaceState always carries template fields. Leaving them
      // out of the fixture started throwing before provenance assertions ran.
      .replace('import { useWorkspace } from "./app-context";', 'const useWorkspace = () => ({ state: { mapServers: [], settings: {}, activeTemplateOverrides: {}, templates: [] } });');
  } }],
});
const { OperationalLiveMap } = await vite.ssrLoadModule('/components/bluewolf/operational-live-map.tsx');
const cursor = await vite.ssrLoadModule('/lib/operator-time-cursor.ts');
const evidence = await vite.ssrLoadModule('/lib/live-map-evidence.ts');
const simulation = await vite.ssrLoadModule('/lib/simulation-investigation.ts');
const time = Date.parse('2026-09-22T10:00:00Z');
const originalFetch = globalThis.fetch;
function render(extra = {}) {
  harness.index = 0; harness.effectIndex = 0; harness.pending = [];
  return OperationalLiveMap({ serverId: '1', selectedGroupId: 'g1', selectedVehicle: null, vehicleTypes: [], showGrid: false, showTrace: true, onSelectGroup() {}, onSelectVehicle() {}, ...extra });
}
function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
}
const lines = (tree) => elements(tree, (node) => node.type === 'line');
const routes = (tree) => elements(tree, (node) => node.type === 'polyline');
const flush = () => harness.pending.splice(0).forEach((run) => run());
const settle = () => new Promise((resolve) => setImmediate(resolve));
function result(serverId = 1) {
  return { serverId, eventId: 'e1', groupId: 'g1', templateId: 'tpl', runId: 'run', templateVersion: 'v1',
    routes: [{ routeInstanceId: 'r1', detectionQuality: 0.9, estimatedPeriodS: 180, centerline: [{ latitude: 32, longitude: 34.8 }, { latitude: 32.001, longitude: 34.801 }] }], points: [] };
}
beforeEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  Object.assign(harness, { states: [], effects: [], pending: [] });
  for (const server of ['1', '2', '3']) cursor.publishOperatorCursor(server, null);
  harness.groups = [{ id: 'g1', name: 'G1', color: '#123456', event: { id: 'e1' }, templateId: 'tpl', members: [] }];
  harness.trace = [0, 5000].map((offset) => ({ timeMs: time + offset, groupId: 'g1', eventId: 'e1', vehicleId: 101, latitude: 32 + offset / 1e8, longitude: 34.8, sync: 80 }));
  harness.history = [{ observedAt: new Date(time + 5000).toISOString(), serverId: '1', groups: [{ id: 'g1', event: { id: 'e1' } }] }];
  globalThis.fetch = async () => { throw new Error('no fetch fixture'); };
});
afterEach(() => { globalThis.fetch = originalFetch; });
after(async () => { harness.effects.forEach((effect) => effect.cleanup?.()); await vite.close(); delete globalThis.__bluewolfMapTest; });

test('BW-UI-005 missing or stale historical frame renders no live trace', () => {
  cursor.publishOperatorCursor('1', new Date(time - 60_000).toISOString());
  assert.equal(lines(render()).length, 0);
  harness.history = [];
  assert.equal(lines(render()).length, 0);
});

test('BW-UI-005 available historical frame clips future trace while LIVE retains it', () => {
  harness.trace.push({ ...harness.trace[1], timeMs: time + 10_000 });
  assert.equal(lines(render()).length, 2);
  cursor.publishOperatorCursor('1', new Date(time + 5000).toISOString());
  harness.states = [];
  assert.equal(lines(render()).length, 1);
});

test('OP-02 cached event evidence cannot follow identical group/event IDs to another server', () => {
  render();
  harness.states[0] = evidence.extractLiveMapEventEvidence(result(1));
  assert.equal(routes(render()).length, 1);
  assert.equal(routes(render({ serverId: '2' })).length, 0);
  assert.equal(routes(render({ serverId: '3' })).length, 0);
});

test('OP-04 wrong-server recompute override cannot render route or version evidence', () => {
  const tree = render({ serverId: '2', recomputeOverride: result(1) });
  assert.equal(routes(tree).length, 0);
  assert.equal(elements(tree, (node) => 'data-op04-version' in node.props).length, 0);
});

test('OP-02 map recompute request carries the selected server and reruns on server switch', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ error: 'unavailable' }, { status: 503 }); };
  render(); flush(); await settle();
  render({ serverId: '2' }); flush(); await settle();
  render({ serverId: '3' }); flush(); await settle();
  assert.deepEqual(bodies.map((body) => body.serverId), [1, 2, 3]);
});

test('OP-02 delayed and wrong-server responses cannot replace current map evidence', async () => {
  const pending = [];
  globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
  const now = new Date('2026-09-22T12:00:00Z');
  const event = simulation.simulationEvents(1, now)[0];
  const payload = simulation.recomputeSimulationEvent({ serverId: 1, eventId: event.eventId, templateId: event.activeTemplateId, now });
  Object.assign(payload, { eventId: 'e1', groupId: 'g1', templateId: 'tpl' });
  render(); flush();
  render({ serverId: '2' }); flush();
  pending[0](Response.json(payload)); await settle();
  assert.equal(routes(render({ serverId: '2' })).length, 0, 'cancelled request for server 1');
  pending[1](Response.json(payload)); await settle();
  assert.equal(routes(render({ serverId: '2' })).length, 0, 'response lies about requested server');
  render({ serverId: '3' }); flush();
  pending[2](Response.json({ ...payload, serverId: 3 })); await settle();
  assert.ok(routes(render({ serverId: '3' })).length > 0, 'matching response must still render');
});
