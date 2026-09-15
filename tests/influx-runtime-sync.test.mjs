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
const { syncInfluxToOperationalConfig } = await vite.ssrLoadModule("/lib/influx-runtime-sync.ts");

test("IN-01 atomically writes saved Workspace mapping into the operational config without copying token", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bluewolf-influx-"));
  const configPath = path.join(directory, "runtime.json");
  const previous = process.env.BLUEWOLF_OPERATIONAL_CONFIG;
  try {
    await writeFile(configPath, JSON.stringify({
      influx: { url: "old", organization: "old", tokenEnv: "BLUEWOLF_INFLUX_TOKEN", stream: {}, metrics: [] },
      join: { logicalGridSeconds: 1 },
      polling: { logicalGridSeconds: 1 },
      preserve: { templates: true },
    }), "utf8");
    process.env.BLUEWOLF_OPERATIONAL_CONFIG = configPath;
    const influx = structuredClone(DEFAULT_WORKSPACE.influx);
    influx.token = "never-write-this-secret";
    influx.stream = { serverColumn: "srv_join", timeColumn: "when_utc", vehicleNumberColumn: "vehicle_join" };
    const active = influx.mappings.find((item) => item.systemKey === "active");
    active.valueMode = "special";
    active.sourceValue = "GREEN";
    active.mappedValue = "true";

    const result = await syncInfluxToOperationalConfig(influx);
    assert.equal(result.synced, true);
    assert.equal(result.restartRequired, true);
    assert.equal(result.configPath, configPath);

    const savedText = await readFile(configPath, "utf8");
    const saved = JSON.parse(savedText);
    assert.deepEqual(saved.preserve, { templates: true });
    assert.deepEqual(saved.influx.stream, { serverColumn: "srv_join", timeColumn: "when_utc", vehicleNumberColumn: "vehicle_join" });
    assert.equal(saved.influx.tokenEnv, "BLUEWOLF_INFLUX_TOKEN");
    assert.ok(!savedText.includes(influx.token));
    assert.deepEqual(saved.influx.metrics.find((row) => row.metric === "active").valueMap, { GREEN: true });
  } finally {
    if (previous === undefined) delete process.env.BLUEWOLF_OPERATIONAL_CONFIG;
    else process.env.BLUEWOLF_OPERATIONAL_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("IN-01 does not claim runtime application when no operational config path exists", async () => {
  const previous = process.env.BLUEWOLF_OPERATIONAL_CONFIG;
  try {
    delete process.env.BLUEWOLF_OPERATIONAL_CONFIG;
    const result = await syncInfluxToOperationalConfig(structuredClone(DEFAULT_WORKSPACE.influx));
    assert.equal(result.synced, false);
    assert.equal(result.restartRequired, false);
    assert.match(result.reason, /not configured/);
  } finally {
    if (previous !== undefined) process.env.BLUEWOLF_OPERATIONAL_CONFIG = previous;
  }
});
