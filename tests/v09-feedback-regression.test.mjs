import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFile(path.join(root, file), "utf8");

test("v0.9 feedback requirements are wired into source and official SRS", async () => {
  const [geometry, map, operator, templates, investigation, gt, routeBank, settings, srs] = await Promise.all([
    read("components/bluewolf/v09/geometry.ts"),
    read("components/bluewolf/v09/map.tsx"),
    read("components/bluewolf/v09/operator.tsx"),
    read("components/bluewolf/v09/template-builder.tsx"),
    read("components/bluewolf/v09/investigation.tsx"),
    read("components/bluewolf/v09/gt.tsx"),
    read("components/bluewolf/v09/route-bank.tsx"),
    read("components/bluewolf/v09/infra-settings.tsx"),
    read("docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06.md"),
  ]);

  assert.match(geometry, /outward semicircles, never inward hooks/i);
  assert.match(geometry, /topA.*topB/is);
  assert.match(geometry, /bottomB.*bottomA/is);
  assert.match(geometry, /doubleHippodromeLoop/);
  assert.match(map, /scoreTrace/);
  assert.match(map, /TYPE_COLORS = \["#f59e0b", "#2563eb", "#8b5cf6"\]/);
  assert.match(operator, /מפת בסיס/);
  assert.match(operator, /עקבה לפי ציון/);
  assert.match(operator, /windowMinutes/);
  assert.match(templates, /v09-stepper/);
  assert.match(templates, /overlapPair/);
  assert.match(templates, /one vehicle type per route entity/i);
  assert.match(investigation, /PDF נוצר עם מפת סיכום ומפה לכל Event/);
  assert.match(investigation, /הצטרפו:/);
  assert.match(investigation, /יצאו:/);
  assert.match(gt, /העקבות המקוריות/);
  assert.match(gt, /v09-axis-handle/);
  assert.match(routeBank, /חבר 2 ל‑Double/);
  assert.match(routeBank, /data-kind="radius"/);
  assert.match(routeBank, /data-kind="angle"/);
  assert.match(settings, /v09-range-list/);
  assert.match(srs, /SRS-2701/);
  assert.match(srs, /## 41\. v1\.1 release gate/);
  assert.match(srs, /Browser QA passes on desktop and iPhone-sized RTL viewport/);
});
