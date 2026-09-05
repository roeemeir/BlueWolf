import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (name) => readFile(path.join(root, name), "utf8");

test("retrospective models stable group events rather than alert chapters", async () => {
  const source = await read("components/bluewolf/investigation-view.tsx");
  assert.match(source, /אירוע = רצף קבוצתיות יציב/);
  assert.match(source, /startReason/);
  assert.match(source, /endReason/);
  assert.match(source, /rootCauses/);
  assert.match(source, /groupWeighted/);
  assert.match(source, /best\.start/);
  assert.doesNotMatch(source, /activeAlert|alertHistory|התראות.*map\(/);
});

test("retrospective exposes per-vehicle scores and immediate template recalculation", async () => {
  const source = await read("components/bluewolf/investigation-view.tsx");
  assert.match(source, /v08-member-table/);
  assert.match(source, />רכב</);
  assert.match(source, />כולל</);
  assert.match(source, />Sync</);
  assert.match(source, />Route</);
  assert.match(source, /templateRecalculation/);
  assert.match(source, /לפני/);
  assert.match(source, /אחרי/);
});

test("PDF export is a real direct PDF download, not a print popup", async () => {
  const source = await read("components/bluewolf/investigation-view.tsx");
  assert.match(source, /function buildPdf/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /%PDF-1\.4/);
  assert.match(source, /link\.download = `blue-wolf-/);
  assert.doesNotMatch(source, /window\.open/);
  assert.doesNotMatch(source, /window\.print/);
});

test("summary map preserves saved route placement and separates route/group colors", async () => {
  const source = await read("components/bluewolf/investigation-view.tsx");
  assert.match(source, /route\.mapX/);
  assert.match(source, /route\.mapY/);
  assert.match(source, /route\.rotationDeg/);
  assert.match(source, /vehicleTypes\.find/);
  assert.match(source, /groupLineColor\[event\.family\]/);
});

test("v0.8 style layer is loaded and includes mobile safe-area and touch targets", async () => {
  const layout = await read("app/layout.tsx");
  const css = await read("app/v08.css");
  assert.match(layout, /import "\.\/v08\.css"/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /v08-investigation-summary/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
