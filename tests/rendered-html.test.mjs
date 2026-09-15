import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("builds the Hebrew Blue Wolf application shell", async () => {
  // `npm test` runs `next build` before this suite. Assert the build exists, but
  // keep the UI contract independent of Next's private server bundle layout.
  await access(path.join(root, ".next", "BUILD_ID"));
  const layout = await readFile(path.join(root, "app/layout.tsx"), "utf8");
  const dashboard = await readFile(path.join(root, "components/bluewolf/dashboard-app.tsx"), "utf8");
  const visuals = await readFile(path.join(root, "components/bluewolf/visuals.tsx"), "utf8");

  assert.match(layout, /זאב כחול \| ניטור סנכרון רכבים/);
  assert.match(layout, /lang="he"/);
  assert.match(layout, /dir="rtl"/);
  assert.match(dashboard, /ניטור סנכרון רכבים/);
  assert.match(visuals, /מכין סביבת עבודה/);
});
