import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });

const simulator = await vite.ssrLoadModule("/lib/simulation-investigation.ts");
const contract = await vite.ssrLoadModule("/lib/investigation-contract.ts");

const NOW = new Date("2026-09-18T12:00:00.000Z");

test("simulator exposes seven days of varied archived scenarios on all three servers", () => {
  for (const serverId of [1, 2, 3]) {
    const events = simulator.simulationEvents(serverId, NOW);
    const historical = events.filter((event) => !event.eventId.endsWith("-active"));
    assert.equal(historical.length, 7 * 4);
    assert.equal(events.filter((event) => event.eventId.endsWith("-active")).length, 2);
    assert.ok(new Set(historical.map((event) => event.scenarioKind)).size >= 4);
    assert.ok(new Set(historical.map((event) => event.family)).has("SI"));
    assert.ok(new Set(historical.map((event) => event.family)).has("SO"));
  }
});

test("SO simulator uses the same Double-as-two-unit global concave smile law", () => {
  const eventId = simulator.simulationEvents(1, NOW).find((event) => event.family === "SO").eventId;
  const result = simulator.recomputeSimulationEvent({ serverId: 1, eventId, templateId: "tpl-so-h", now: NOW });
  const normalized = contract.normalizeEventRecompute(result);
  assert.equal(normalized.routes.length, 3);
  assert.deepEqual(normalized.routes.map((route) => route.orientationDeg), [-45, 0, 45]);
  assert.equal(normalized.routes[1].topology, "double");
});

test("event-start simulation recomputation changes deterministically with the selected template", () => {
  const eventId = simulator.simulationActiveEventId(2, "SO");
  const first = simulator.recomputeSimulationEvent({ serverId: 2, eventId, templateId: "tpl-so-h", now: NOW });
  const second = simulator.recomputeSimulationEvent({
    serverId: 2,
    eventId,
    templateId: "custom-so",
    template: { id: "custom-so", family: "SO", values: [2, 2, 1], soSpec: { chain: ["single", "double", "single"], singleCounts: {}, doubleCounts: {}, relations: ["opposite", "mixed"] } },
    now: NOW,
  });
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(first.templateVersion, second.templateVersion);
  assert.notEqual(first.summary.sync, second.summary.sync);
  assert.equal(first.startAt, second.startAt);
});

test("seven-day simulation report is built without Python Core and preserves archive provenance", () => {
  const built = simulator.buildSimulationInvestigationReport({
    serverId: 3,
    from: "2026-09-12T00:00:00.000Z",
    to: "2026-09-18T23:59:59.999Z",
    now: NOW,
  });
  assert.equal(built.source, "simulator-archive");
  assert.ok(built.report.events.length >= 24);
  assert.equal(built.report.serverId, 3);
  assert.ok(built.report.events.every((event) => event.result.codeVersion === simulator.SIMULATION_CODE_VERSION));
});
