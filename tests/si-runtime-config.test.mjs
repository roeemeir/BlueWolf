import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { buildOperationalSiConfig, operationalSiTemplates } = await vite.ssrLoadModule("/lib/si-runtime-config.ts");
const fixture = JSON.parse(await readFile(new URL("./fixtures/si-runtime-bridge.json", import.meta.url), "utf8"));

test("BW-SYNC-012 converts coordinate SI editor truth into exact operational phase slots", () => {
  const output = operationalSiTemplates(fixture.workspaceTemplates, fixture.vehicleTypes);
  assert.deepEqual(output, fixture.expectedSiTemplates);
  assert.equal(output[0].slots[1].phaseOffset, 1 / 3);
  assert.equal(output[1].slots[1].phaseOffset, 1 / 4);
  assert.equal(output.some((item) => item.id === "legacy-pair-only"), false);
});

test("BW-SYNC-012 updates only siTemplates and preserves unrelated operational configuration", () => {
  const existing = {
    influx: { url: "http://influx.internal" },
    templates: [{ id: "so-runtime-template", routes: [] }],
    servers: [{ id: 1 }],
    unrelated: { preserve: true },
  };
  const output = buildOperationalSiConfig(existing, fixture.workspaceTemplates, fixture.vehicleTypes);
  assert.deepEqual(output.siTemplates, fixture.expectedSiTemplates);
  assert.deepEqual(output.templates, existing.templates);
  assert.deepEqual(output.servers, existing.servers);
  assert.deepEqual(output.unrelated, { preserve: true });
});

test("BW-SYNC-012 rejects non-30-degree placement, forbidden ring and duplicate coordinate", () => {
  const badAngle = structuredClone(fixture.workspaceTemplates);
  badAngle[0].siPositions[1].angleDeg = 119;
  assert.throws(() => operationalSiTemplates(badAngle, fixture.vehicleTypes), /multiple of 30 degrees/);

  const badRing = structuredClone(fixture.workspaceTemplates);
  badRing[0].siPositions[1].ring = "inner";
  assert.throws(() => operationalSiTemplates(badRing, fixture.vehicleTypes), /forbidden ring/);

  const duplicate = structuredClone(fixture.workspaceTemplates);
  duplicate[0].siPositions[1] = { typeId: "lightning", ring: "outer", angleDeg: 0 };
  assert.throws(() => operationalSiTemplates(duplicate, fixture.vehicleTypes), /duplicate placement/);
});

test("BW-SYNC-012 workspace save is wired to server-side SI runtime synchronization", async () => {
  const route = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
  const sync = await readFile(new URL("../lib/si-runtime-sync.ts", import.meta.url), "utf8");
  assert.match(route, /category === "templates"/);
  assert.match(route, /syncSiTemplatesToOperationalConfig/);
  assert.match(route, /SI template runtime config sync failed/);
  assert.match(sync, /BLUEWOLF_OPERATIONAL_CONFIG/);
  assert.match(sync, /fs\.rename\(temp, configPath\)/);
  assert.match(sync, /restartRequired: true/);
});
