import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
const { buildOperationalSiTemplateConfig, operationalSiTemplates } = await vite.ssrLoadModule("/lib/si-runtime-config.ts");

function coordinateTemplate(id, positions, isDefault = false) {
  return {
    id,
    family: "SI",
    name: id,
    mix: "test",
    constellation: "test",
    law: "coordinate",
    values: [],
    isDefault,
    updatedAt: "2026-09-17T00:00:00.000Z",
    siPositions: positions,
  };
}

test("BW-SYNC-012 converts saved SI coordinates into deterministic Core phase offsets and ring roles", () => {
  const [first, second] = DEFAULT_WORKSPACE.vehicleTypes;
  const template = coordinateTemplate("si-runtime", [
    { typeId: second.id, ring: second.siRoles[0], angleDeg: 120 },
    { typeId: first.id, ring: first.siRoles[0], angleDeg: 0 },
  ], true);
  const output = operationalSiTemplates([template], DEFAULT_WORKSPACE.vehicleTypes);
  assert.equal(output.length, 1);
  assert.equal(output[0].id, "si-runtime");
  assert.equal(output[0].default, true);
  assert.deepEqual(output[0].slots.map((slot) => slot.phaseOffset).sort((a, b) => a - b), [0, 1 / 3]);
  assert.deepEqual(new Set(output[0].slots.map((slot) => slot.routeRole)), new Set([first.siRoles[0], second.siRoles[0]]));
  assert.deepEqual(new Set(output[0].slots.map((slot) => slot.vehicleType)), new Set([first.id, second.id]));
});

test("BW-SYNC-012 operational SI serialization is independent of click/insertion order", () => {
  const type = DEFAULT_WORKSPACE.vehicleTypes.find((item) => item.siRoles.includes("outer"));
  assert.ok(type);
  const positions = [
    { typeId: type.id, ring: "outer", angleDeg: 120 },
    { typeId: type.id, ring: "outer", angleDeg: 0 },
    { typeId: type.id, ring: "outer", angleDeg: 240 },
  ];
  const first = operationalSiTemplates([coordinateTemplate("stable", positions)], DEFAULT_WORKSPACE.vehicleTypes);
  const second = operationalSiTemplates([coordinateTemplate("stable", [...positions].reverse())], DEFAULT_WORKSPACE.vehicleTypes);
  assert.deepEqual(first, second);
});

test("BW-SYNC-012 does not fabricate coordinates for legacy pair-only SI templates", () => {
  const legacy = DEFAULT_WORKSPACE.templates.find((template) => template.family === "SI" && template.siPositions === undefined);
  assert.ok(legacy);
  assert.deepEqual(operationalSiTemplates([legacy], DEFAULT_WORKSPACE.vehicleTypes), []);
});

test("BW-SYNC-012 rejects invalid coordinate templates before they reach operational config", () => {
  const type = DEFAULT_WORKSPACE.vehicleTypes.find((item) => item.siRoles.length);
  assert.ok(type);
  const badAngle = coordinateTemplate("bad-angle", [
    { typeId: type.id, ring: type.siRoles[0], angleDeg: 0 },
    { typeId: type.id, ring: type.siRoles[0], angleDeg: 95 },
  ]);
  assert.throws(() => operationalSiTemplates([badAngle], DEFAULT_WORKSPACE.vehicleTypes), /30/);

  const unknownType = coordinateTemplate("unknown", [
    { typeId: type.id, ring: type.siRoles[0], angleDeg: 0 },
    { typeId: "missing-type", ring: type.siRoles[0], angleDeg: 120 },
  ]);
  assert.throws(() => operationalSiTemplates([unknownType], DEFAULT_WORKSPACE.vehicleTypes), /missing-type/);
});

test("BW-SYNC-012 SI runtime update preserves unrelated operational and SO configuration", () => {
  const type = DEFAULT_WORKSPACE.vehicleTypes.find((item) => item.siRoles.includes("outer"));
  assert.ok(type);
  const existing = {
    influx: { preserve: true },
    templates: [{ id: "so-existing", name: "SO", routes: [] }],
    servers: [{ id: 1 }],
    unrelated: { keep: "yes" },
  };
  const output = buildOperationalSiTemplateConfig(existing, [coordinateTemplate("si-new", [
    { typeId: type.id, ring: "outer", angleDeg: 0 },
    { typeId: type.id, ring: "outer", angleDeg: 120 },
  ])], DEFAULT_WORKSPACE.vehicleTypes);
  assert.deepEqual(output.templates, existing.templates);
  assert.deepEqual(output.influx, existing.influx);
  assert.deepEqual(output.servers, existing.servers);
  assert.deepEqual(output.unrelated, existing.unrelated);
  assert.equal(output.siTemplates[0].id, "si-new");
});
