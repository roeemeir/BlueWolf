import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
const {
  MAX_NOMINAL_LIVE_LATENCY_SECONDS,
  buildOperationalInfluxConfig,
  nominalLiveLatencySeconds,
  validateInfluxSettings,
  validateLiveLatencyBudget,
} = await vite.ssrLoadModule("/lib/influx-runtime-config.ts");

function configuredInflux() {
  const influx = structuredClone(DEFAULT_WORKSPACE.influx);
  influx.url = "http://influx.real:8086";
  influx.organization = "ops-org";
  influx.token = "workspace-secret-must-not-leak";
  influx.stream = { serverColumn: "srv_join", timeColumn: "when_utc", vehicleNumberColumn: "vehicle_join" };
  const active = influx.mappings.find((item) => item.systemKey === "active");
  active.valueMode = "special";
  active.sourceValue = "GREEN";
  active.mappedValue = "true";
  return influx;
}

function existingConfig(activeValueMap = undefined) {
  return {
    unrelated: { preserve: true },
    influx: {
      url: "old",
      organization: "old",
      tokenEnv: "BLUEWOLF_INFLUX_TOKEN",
      timeoutMs: 9000,
      stream: { serverColumn: "old-server", timeColumn: "_time", vehicleNumberColumn: "old-vehicle" },
      metrics: activeValueMap === undefined ? [] : [
        { metric: "active", bucket: "navigation", measurement: "active", field: "value", valueMap: activeValueMap },
      ],
    },
    join: { logicalGridSeconds: 1, toleranceSeconds: 99 },
    polling: { logicalGridSeconds: 1, activePollSeconds: 99, idleProbeSeconds: 99, joinToleranceSeconds: 99 },
  };
}

test("IN-01 converts saved join columns and transformations into real operational runtime config", () => {
  const influx = configuredInflux();
  const output = buildOperationalInfluxConfig(existingConfig(), influx);
  assert.deepEqual(output.unrelated, { preserve: true });
  assert.equal(output.influx.tokenEnv, "BLUEWOLF_INFLUX_TOKEN");
  assert.equal(output.influx.timeoutMs, 9000);
  assert.deepEqual(output.influx.stream, {
    serverColumn: "srv_join",
    timeColumn: "when_utc",
    vehicleNumberColumn: "vehicle_join",
  });
  assert.equal(output.join.toleranceSeconds, influx.joinToleranceSeconds);
  assert.equal(output.polling.activePollSeconds, influx.activePollSeconds);
  assert.equal(output.polling.idleProbeSeconds, influx.idleProbeMinutes * 60);
  assert.equal(output.polling.joinToleranceSeconds, influx.joinToleranceSeconds);

  const active = output.influx.metrics.find((item) => item.metric === "active");
  assert.deepEqual(active.valueMap, { GREEN: true });
  assert.ok(output.influx.metrics.some((item) => item.metric === "vehicle_identifier"));
  assert.ok(output.influx.metrics.some((item) => item.metric === "latitude_deg"));
  assert.ok(!output.influx.metrics.some((item) => item.metric === "vehicleNumber"));
  assert.ok(!JSON.stringify(output).includes(influx.token));
});

test("IN-01 editing one special rule preserves other runtime value-map rules", () => {
  const output = buildOperationalInfluxConfig(existingConfig({ red: false }), configuredInflux());
  const active = output.influx.metrics.find((item) => item.metric === "active");
  assert.deepEqual(active.valueMap, { red: false, GREEN: true });
});

test("IN-01 as-is explicitly removes previous runtime value transformation", () => {
  const influx = configuredInflux();
  const activeSetting = influx.mappings.find((item) => item.systemKey === "active");
  activeSetting.valueMode = "as-is";
  const output = buildOperationalInfluxConfig(existingConfig({ green: true, red: false }), influx);
  const active = output.influx.metrics.find((item) => item.metric === "active");
  assert.equal("valueMap" in active, false);
});

test("IN-01 rejects ambiguous join columns and malformed special transformations", () => {
  const duplicate = configuredInflux();
  duplicate.stream.timeColumn = duplicate.stream.serverColumn;
  assert.throws(() => validateInfluxSettings(duplicate), /must be distinct/);

  const invalidTransform = configuredInflux();
  const active = invalidTransform.mappings.find((item) => item.systemKey === "active");
  active.sourceValue = "";
  assert.throws(() => validateInfluxSettings(invalidTransform), /sourceValue/);
});

test("BW-DATA-010 default join + active poll + UI refresh fits the <=10s live latency budget", () => {
  const total = nominalLiveLatencySeconds(DEFAULT_WORKSPACE.influx, DEFAULT_WORKSPACE.settings.uiRefreshSeconds);
  assert.equal(MAX_NOMINAL_LIVE_LATENCY_SECONDS, 10);
  assert.equal(DEFAULT_WORKSPACE.influx.joinToleranceSeconds, 5);
  assert.equal(DEFAULT_WORKSPACE.influx.activePollSeconds, 3);
  assert.equal(DEFAULT_WORKSPACE.settings.uiRefreshSeconds, 2);
  assert.equal(total, 10);
  assert.equal(validateLiveLatencyBudget(DEFAULT_WORKSPACE.influx, DEFAULT_WORKSPACE.settings.uiRefreshSeconds), 10);

  const tooSlow = structuredClone(DEFAULT_WORKSPACE.influx);
  tooSlow.activePollSeconds = 4;
  assert.throws(() => validateLiveLatencyBudget(tooSlow, 2), /exceeds 10s/);
});

test("IN-01 active developer surface exposes all three join names and special value mapping", async () => {
  const ui = await readFile(new URL("../components/bluewolf/influx-governance-workbench.tsx", import.meta.url), "utf8");
  const governance = await readFile(new URL("../components/bluewolf/developer-governance-workbench.tsx", import.meta.url), "utf8");
  assert.match(ui, /data-requirements="IN-01"/);
  assert.match(ui, /serverColumn/);
  assert.match(ui, /timeColumn/);
  assert.match(ui, /vehicleNumberColumn/);
  assert.match(ui, /valueMode/);
  assert.match(ui, /sourceValue/);
  assert.match(ui, /mappedValue/);
  assert.match(ui, /special map/);
  assert.match(governance, /<TabsTrigger value="sources">/);
  assert.match(governance, /<TabsContent value="sources">.*<InfluxGovernanceWorkbench \/>/);
  assert.doesNotMatch(governance, /button:nth-child\(4\)/);
});

test("IN-01 workspace persistence is wired to server-only runtime sync and reports application truthfully", async () => {
  const route = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
  const context = await readFile(new URL("../components/bluewolf/app-context.tsx", import.meta.url), "utf8");
  assert.match(route, /import\("@\/lib\/influx-runtime-sync"\)/);
  assert.match(route, /syncInfluxToOperationalConfig\(influxFromState\(normalizedState\)\)/);
  assert.match(route, /runtimeSync/);
  assert.match(context, /category === "influx"/);
  assert.match(context, /לא הוחל על ה־Core/);
  assert.match(context, /נדרשת הפעלה מחדש של שירות הליבה/);
});
