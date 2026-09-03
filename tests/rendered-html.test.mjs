import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("builds the Hebrew Blue Wolf application shell", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const worker = await readFile(path.join(root, "dist/server/index.js"), "utf8");
  const assetNames = await readdir(path.join(root, "dist/server/ssr/assets"));
  const assets = (await Promise.all(assetNames.filter((name) => name.endsWith(".js")).map((name) => readFile(path.join(root, "dist/server/ssr/assets", name), "utf8")))).join("\n");

  assert.match(worker, /זאב כחול \| ניטור סנכרון רכבים/);
  assert.match(worker, /lang:\s*"he"/);
  assert.match(worker, /dir:\s*"rtl"/);
  assert.match(assets, /ניטור סנכרון רכבים/);
  assert.match(assets, /מכין סביבת עבודה/);
});
