import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
const { syncSiTemplatesToOperationalConfig } = await vite.ssrLoadModule("/lib/si-runtime-sync.ts");

function coordinateTemplate(typeId) {
  return {
    id: "si-runtime-sync",
    family: "SI",
    name: "SI runtime sync",
    mix: "test",
    constellation: "test",
    law: "coordinate",
    values: [],
    isDefault: true,
    updatedAt: "2026-09-17T00:00:00.000Z",
    siPositions: [
      { typeId, ring: "outer", angleDeg: 0 },
      { typeId, ring: "outer", angleDeg: 120 },
    ],
  };
}

test("BW-SYNC-012 atomically writes coordinate SI templates while preserving SO runtime configuration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bluewolf-si-runtime-"));
  const configPath = path.join(directory, "runtime.json");
  const previous = process.env.BLUEWOLF_OPERATIONAL_CONFIG;
  try {
    const type = DEFAULT_WORKSPACE.vehicleTypes.find((item) => item.siRoles.includes("outer"));
    assert.ok(type);
    const existing = {
      influx: { preserve: true },
      templates: [{ id: "so-existing", name: "SO existing", routes: [] }],
      servers: [{ id: 1, groups: [] }],
    };
    await writeFile(configPath, JSON.stringify(existing), "utf8");
    process.env.BLUEWOLF_OPERATIONAL_CONFIG = configPath;

    const result = await syncSiTemplatesToOperationalConfig([coordinateTemplate(type.id)], DEFAULT_WORKSPACE.vehicleTypes);
    assert.equal(result.synced, true);
    assert.equal(result.restartRequired, true);
    assert.equal(result.configPath, configPath);

    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(saved.templates, existing.templates);
    assert.deepEqual(saved.influx, existing.influx);
    assert.deepEqual(saved.servers, existing.servers);
    assert.equal(saved.siTemplates.length, 1);
    assert.deepEqual(saved.siTemplates[0].slots.map((slot) => slot.phaseOffset), [0, 1 / 3]);
  } finally {
    if (previous === undefined) delete process.env.BLUEWOLF_OPERATIONAL_CONFIG;
    else process.env.BLUEWOLF_OPERATIONAL_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("BW-SYNC-012 does not claim Core application when operational config is not configured", async () => {
  const previous = process.env.BLUEWOLF_OPERATIONAL_CONFIG;
  try {
    delete process.env.BLUEWOLF_OPERATIONAL_CONFIG;
    const result = await syncSiTemplatesToOperationalConfig([], DEFAULT_WORKSPACE.vehicleTypes);
    assert.equal(result.synced, false);
    assert.equal(result.restartRequired, false);
    assert.match(result.reason, /not configured/);
  } finally {
    if (previous !== undefined) process.env.BLUEWOLF_OPERATIONAL_CONFIG = previous;
  }
});
