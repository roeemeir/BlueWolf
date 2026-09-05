import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const preview = path.join(root, "preview-v08");

test("v0.8 preview loads every declared CSS and JS asset", async () => {
  const html = await readFile(path.join(preview, "index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="\.\/(.+?)"/g)].map((match) => match[1]);
  assert.deepEqual(assets, ["styles.css", "core.js", "core-patch.js", "app.js"]);
  for (const asset of assets) {
    const file = path.join(preview, asset);
    const info = await stat(file);
    assert.ok(info.size > 100, `${asset} must be non-empty`);
    const body = await readFile(file, "utf8");
    assert.ok(body.length > 100, `${asset} must decode as UTF-8`);
  }
});

test("v0.8 preview asset order preserves the core patch before the UI", async () => {
  const html = await readFile(path.join(preview, "index.html"), "utf8");
  const core = html.indexOf("./core.js");
  const patch = html.indexOf("./core-patch.js");
  const app = html.indexOf("./app.js");
  assert.ok(core >= 0 && patch > core && app > patch);
});

test("v0.8 preview contains executable core and application entry points", async () => {
  const core = await readFile(path.join(preview, "core.js"), "utf8");
  const patch = await readFile(path.join(preview, "core-patch.js"), "utf8");
  const app = await readFile(path.join(preview, "app.js"), "utf8");
  assert.match(core, /window\.BWCore/);
  assert.match(patch, /BWCore/);
  assert.match(app, /BWCore/);
  assert.doesNotMatch(core + patch + app, /<script/i);
});

test("v0.8 preview CSS includes responsive mobile and dark-mode contracts", async () => {
  const css = await readFile(path.join(preview, "styles.css"), "utf8");
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /body\.dark/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.live-map-wrap/);
});