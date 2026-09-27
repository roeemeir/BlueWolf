import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = await mkdtemp(join(tmpdir(), "bluewolf-offline-http-"));
const port = "18347";
const origin = "http://127.0.0.1:" + port;
let child;
let output = "";
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try { await done; } finally { clearTimeout(timer); }
}
async function start() {
  child = spawn(process.execPath, ["scripts/start-offline.mjs"], {
    env: { ...process.env, PORT: port, BLUEWOLF_SQLITE_PATH: join(directory, "workspace.sqlite") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  let startupError;
  child.on("error", error => { startupError = error; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error("Offline server exited: " + output);
    try {
      const response = await fetch(origin + "/api/workspace", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* readiness only */ }
    await delay(250);
  }
  throw new Error("Offline server readiness timed out: " + output);
}
async function read() {
  const response = await fetch(origin + "/api/workspace");
  assert.equal(response.status, 200);
  const payload = await response.json();
  // GET intentionally enriches an old workspace with a usable WMTS base layer.
  // This presentation migration must not turn the user-owned revision or WKT
  // state into a different persistence version. Test both independently.
  assert.ok(payload.state.mapServers.some(source => source.id === "omniscale-demo" && source.enabled));
  assert.equal(payload.state.settings.defaultMap, "omniscale-demo");
  return payload;
}
function persistedFixtureFields(state) {
  return { routes: state.routes, templates: state.templates, gtSegments: state.gtSegments };
}
async function write(state, revision) {
  return fetch(origin + "/api/workspace", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, expectedRevision: revision, category: "routes", action: "save-bank", detail: "offline persistence regression" }),
  });
}
async function versions() {
  const response = await fetch(origin + "/api/workspace/versions", { cache: "no-store" });
  assert.equal(response.status, 200);
  return response.json();
}
async function restore(sourceRevision, expectedRevision) {
  return fetch(origin + "/api/workspace/versions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: sourceRevision, expectedRevision }),
  });
}
try {
  await start();
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /dir="rtl"/);
  assert.doesNotMatch(html, /<(?:link|script)[^>]+(?:href|src)=["']https?:\/\//i, "Offline shell must not load remote CSS/JS assets");
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length, "Offline page must reference local built assets");
  for (const asset of new Set(assets)) {
    const url = new URL(asset.replaceAll("&amp;", "&"), origin);
    assert.equal(url.origin, origin);
    const assetResponse = await fetch(url);
    assert.equal(assetResponse.status, 200, "Missing offline asset: " + asset);
    if (url.pathname.endsWith(".css")) {
      const css = await assetResponse.text();
      assert.doesNotMatch(css, /@import\s+(?:url\()?\s*["']?https?:\/\//i, "Offline CSS must not import remote styles/fonts");
      assert.doesNotMatch(css, /@font-face[\s\S]{0,1200}?src\s*:[^;}]*https?:\/\//i, "Offline fonts must not require remote HTTP");
    }
  }
  const initial = await read();
  assert.equal(initial.storage, "sqlite");
  assert.equal(initial.revision, 0);
  const state = { routes: [{ id: "route-test", name: "נתיב בדיקה", geometry: "LINESTRING (34 32, 34.01 32, 34.01 32.01, 34 32)", mapX: 61, mapY: 42, rotationDeg: 30 }], templates: [], gtSegments: [] };
  const saved = await write(state, 0);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  assert.deepEqual(persistedFixtureFields((await read()).state), state);
  const afterFirstSave = await versions();
  assert.equal(afterFirstSave.schemaVersion, "bluewolf.workspace-versions.v1");
  assert.deepEqual(afterFirstSave.versions.map(row => row.revision), [1]);

  // A second browser with an old revision cannot overwrite the committed bank.
  assert.equal((await write({ routes: [] }, 0)).status, 409);
  await stop();
  await start();
  const restarted = await read();
  assert.deepEqual(persistedFixtureFields(restarted.state), state);
  assert.equal(restarted.revision, 1);
  assert.equal(restarted.logs.length, 1, "Rejected save must not append an audit record");

  const second = await write({ ...state, routes: [] }, 1);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).revision, 2);
  assert.deepEqual((await read()).state.routes, []);
  assert.deepEqual((await versions()).versions.map(row => row.revision), [2, 1]);

  const recovered = await restore(1, 2);
  assert.equal(recovered.status, 200);
  const recoveredPayload = await recovered.json();
  assert.equal(recoveredPayload.revision, 3);
  assert.equal(recoveredPayload.restoredFrom, 1);
  const recoveredState = await read();
  assert.deepEqual(persistedFixtureFields(recoveredState.state), state);
  assert.equal(recoveredState.revision, 3);
  assert.deepEqual((await versions()).versions.map(row => row.revision), [3, 2, 1]);

  await stop();
  await start();
  const recoveredAfterRestart = await read();
  assert.deepEqual(persistedFixtureFields(recoveredAfterRestart.state), state);
  assert.equal(recoveredAfterRestart.revision, 3);
  assert.equal(recoveredAfterRestart.logs[0].category, "recovery");
  console.log("PASS: offline local assets/fonts, WMTS default, SQLite save/version history, stale-write rejection, restore and process restart persistence");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
