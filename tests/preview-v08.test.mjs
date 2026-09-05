import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const preview = path.join(root, "preview-v08");

test("v0.8 offline preview loads every declared CSS and JS asset", async () => {
  const html = await readFile(path.join(preview, "index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="\.\/(.+?)"/g)].map((match) => match[1]);
  assert.ok(assets.includes("styles.css"));
  assert.ok(assets.includes("core.js"));
  assert.ok(assets.includes("core-patch.js"));
  assert.ok(assets.includes("sync-patch.js"));
  assert.ok(assets.includes("app.js"));
  for (const asset of assets) {
    const file = path.join(preview, asset);
    const info = await stat(file);
    assert.ok(info.size > 100, `${asset} must be non-empty`);
    const body = await readFile(file, "utf8");
    assert.ok(body.length > 100, `${asset} must decode as UTF-8`);
  }
});

test("v0.8 offline preview patch order preserves core, sync and UI layering", async () => {
  const html = await readFile(path.join(preview, "index.html"), "utf8");
  const core = html.indexOf("./core.js");
  const patch = html.indexOf("./core-patch.js");
  const sync = html.indexOf("./sync-patch.js");
  const app = html.indexOf("./app.js");
  assert.ok(core >= 0 && patch > core && sync > patch && app > sync);
});

test("v0.8 offline preview contains executable core and application entry points", async () => {
  const core = await readFile(path.join(preview, "core.js"), "utf8");
  const patch = await readFile(path.join(preview, "core-patch.js"), "utf8");
  const sync = await readFile(path.join(preview, "sync-patch.js"), "utf8");
  const app = await readFile(path.join(preview, "app.js"), "utf8");
  assert.match(core, /window\.BWCore/);
  assert.match(patch, /BWCore/);
  assert.match(sync, /BWCore/);
  assert.match(app, /BWCore/);
  assert.doesNotMatch(core + patch + sync + app, /<script/i);
});

test("v0.8 offline preview CSS includes responsive, dark-mode and safe-area contracts", async () => {
  const css = await readFile(path.join(preview, "styles.css"), "utf8");
  assert.match(css, /@media[^\{]*max-width\s*:\s*\d+px/);
  assert.match(css, /body\.dark/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.map-wrap/);
});
