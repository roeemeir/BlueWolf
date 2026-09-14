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
  return response.json();
}
async function write(state, revision) {
  return fetch(origin + "/api/workspace", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, expectedRevision: revision, category: "routes", action: "save-bank", detail: "offline persistence regression" }),
  });
}
try {
  await start();
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /dir="rtl"/);
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length, "Offline page must reference local built assets");
  for (const asset of new Set(assets)) {
    const url = new URL(asset.replaceAll("&amp;", "&"), origin);
    assert.equal(url.origin, origin);
    assert.equal((await fetch(url)).status, 200, "Missing offline asset: " + asset);
  }
  const initial = await read();
  assert.equal(initial.storage, "sqlite");
  assert.equal(initial.revision, 0);
  const state = { routes: [{ id: "route-test", name: "נתיב בדיקה", geometry: "LINESTRING (34 32, 34.01 32, 34.01 32.01, 34 32)", mapX: 61, mapY: 42, rotationDeg: 30 }], templates: [], gtSegments: [] };
  const saved = await write(state, 0);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  assert.deepEqual((await read()).state, state);
  // A second browser with an old revision cannot overwrite the committed bank.
  assert.equal((await write({ routes: [] }, 0)).status, 409);
  await stop();
  await start();
  const restored = await read();
  assert.deepEqual(restored.state, state);
  assert.equal(restored.revision, 1);
  assert.equal(restored.logs.length, 1, "Rejected save must not append an audit record");
  assert.equal((await write({ ...state, routes: [] }, 1)).status, 200);
  assert.deepEqual((await read()).state.routes, []);
  console.log("PASS: offline HTML/assets, SQLite HTTP save, stale-write rejection, process restart and empty-bank persistence");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
