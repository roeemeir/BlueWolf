import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
const { normalizeAndValidateWorkspaceState } = await vite.ssrLoadModule("/lib/workspace-validation.ts");

function coordinateTemplate(typeId, angle = 120) {
  return {
    id: "si-workspace-runtime",
    family: "SI",
    name: "SI workspace runtime",
    mix: "test",
    constellation: "test",
    law: "coordinate",
    values: [],
    isDefault: false,
    updatedAt: "2026-09-17T00:00:00.000Z",
    siPositions: [
      { typeId, ring: "outer", angleDeg: 0 },
      { typeId, ring: "outer", angleDeg: angle },
    ],
  };
}

test("BW-SYNC-012 server-side workspace validation accepts legal coordinate SI truth", () => {
  const state = structuredClone(DEFAULT_WORKSPACE);
  const type = state.vehicleTypes.find((item) => item.siRoles.includes("outer"));
  assert.ok(type);
  state.templates.push(coordinateTemplate(type.id));
  const normalized = normalizeAndValidateWorkspaceState(state);
  assert.equal(normalized.templates.at(-1).siPositions[1].angleDeg, 120);
});

test("BW-SYNC-012 server-side workspace validation rejects coordinate drift that bypasses the UI", () => {
  const state = structuredClone(DEFAULT_WORKSPACE);
  const type = state.vehicleTypes.find((item) => item.siRoles.includes("outer"));
  assert.ok(type);
  state.templates.push(coordinateTemplate(type.id, 95));
  assert.throws(() => normalizeAndValidateWorkspaceState(state), /30/);
});

test("BW-SYNC-012 legacy pair-only SI templates remain readable but are not treated as coordinate truth", () => {
  const state = structuredClone(DEFAULT_WORKSPACE);
  assert.ok(state.templates.some((template) => template.family === "SI" && template.siPositions === undefined));
  assert.doesNotThrow(() => normalizeAndValidateWorkspaceState(state));
});

test("BW-SYNC-012 workspace save invokes server-only SI runtime sync and reports restart truthfully", async () => {
  const route = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
  const context = await readFile(new URL("../components/bluewolf/app-context.tsx", import.meta.url), "utf8");
  assert.match(route, /category === "templates" \|\| category === "vehicle-ranges"/);
  assert.match(route, /import\("@\/lib\/si-runtime-sync"\)/);
  assert.match(route, /syncSiTemplatesToOperationalConfig\(siRuntime\.templates, siRuntime\.vehicleTypes\)/);
  assert.match(context, /תצורת SI נשמרה ב־Workspace אך לא הוחלה על ה־Core/);
  assert.match(context, /תצורת SI נשמרה לקונפיגורציית ה־Core; נדרשת הפעלה מחדש של שירות הליבה/);
});
