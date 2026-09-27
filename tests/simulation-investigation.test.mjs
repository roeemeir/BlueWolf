import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });

const simulator = await vite.ssrLoadModule("/lib/simulation-investigation.ts");
const contract = await vite.ssrLoadModule("/lib/investigation-contract.ts");

const NOW = new Date("2026-09-18T12:00:00.000Z");
const recompute = (serverId, event) => simulator.recomputeSimulationEvent({ serverId, eventId: event.eventId, templateId: event.activeTemplateId, now: NOW });

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
    serverId: 2, eventId, templateId: "custom-so",
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
    serverId: 3, from: "2026-09-12T00:00:00.000Z", to: "2026-09-18T23:59:59.999Z", now: NOW,
  });
  assert.equal(built.source, "simulator-archive");
  assert.ok(built.report.events.length >= 24);
  assert.equal(built.report.serverId, 3);
  assert.ok(built.report.events.every((event) => event.result.codeVersion === simulator.SIMULATION_CODE_VERSION));
});

test("all servers carry deterministic observed navigation distinct from the ideal centerline", () => {
  const samples = [];
  for (const serverId of [1, 2, 3]) {
    const event = simulator.simulationEvents(serverId, NOW).find((row) => row.family === "SI" && row.scenarioKind !== "turn-dropout");
    const result = recompute(serverId, event);
    assert.deepEqual(result, recompute(serverId, event), "offline archive must replay deterministically");
    assert.equal(result.frameCount, 48);
    const positions = result.points.flatMap((frame) => frame.navigation);
    assert.ok(positions.length > 30);
    assert.ok(positions.every((nav) => Number.isFinite(nav.latitude) && Number.isFinite(nav.longitude) && Number.isFinite(nav.headingDeg)));
    const ideal = new Set(result.routes[0].centerline.map((point) => `${point.latitude.toFixed(8)}:${point.longitude.toFixed(8)}`));
    assert.ok(positions.some((position) => !ideal.has(`${position.latitude.toFixed(8)}:${position.longitude.toFixed(8)}`)));
    samples.push(JSON.stringify(positions.slice(0, 3)));
  }
  assert.equal(new Set(samples).size, 3, "each server must have its own observations");
});

test("wind, route departures and varying periods produce distinct QA evidence and nonconstant route scores", () => {
  const archive = [1, 2, 3].flatMap((serverId) => simulator.simulationEvents(serverId, NOW)
    .filter((event) => ["route-entry-exit", "route-drift", "wind-gust", "variable-period"].includes(event.scenarioKind))
    .map((event) => ({ serverId, event })));
  assert.ok(new Set(archive.map(({ event }) => event.scenarioKind)).size >= 3);
  let foundDeparture = false;
  let foundVariableSpeed = false;
  for (const { serverId, event } of archive) {
    const result = recompute(serverId, event);
    contract.normalizeEventRecompute(result);
    const frames = result.points.filter((frame) => frame.navigation.length);
    const scores = frames.map((frame) => frame.group.route);
    assert.ok(new Set(scores).size > 1, `route adherence must respond to ${event.scenarioKind}`);
    const nav = frames.map((frame) => frame.navigation[0]);
    const speeds = nav.map((row) => Math.hypot(row.velocityEastMps, row.velocityNorthMps));
    if (event.scenarioKind === "variable-period" && Math.max(...speeds) - Math.min(...speeds) > 1) foundVariableSpeed = true;
    if (["route-entry-exit", "route-drift"].includes(event.scenarioKind) && Math.min(...scores) < Math.max(...scores) - 10) foundDeparture = true;
  }
  assert.ok(foundVariableSpeed, "period changes must be reflected in sampled navigation velocity");
  assert.ok(foundDeparture, "route departure/return must be reflected in observed route scores");
});
