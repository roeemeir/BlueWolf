import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
const { normalizeAndValidateWorkspaceState } = await vite.ssrLoadModule("/lib/workspace-validation.ts");

const directTemplate = () => ({
  id: "so-direct-workspace-validation",
  family: "SO", name: "SO direct validated", mix: "test", constellation: "single-double",
  law: "direct", values: [2], isDefault: false, updatedAt: "2026-09-23T00:00:00Z",
  soSpec: {
    singleCounts: {}, doubleCounts: {}, chain: ["single", "double"],
    relations: ["opposite"], schemaVersion: "so-direct.v2",
    directPlacements: [
      { routeIndex: 0, phase: 0, direction: "forward" },
      { routeIndex: 1, phase: 0.5, direction: "forward" },
    ],
    generatorCounts: { single: 1, double: 1 },
  },
});

function stateWith(template = directTemplate()) {
  const state = structuredClone(DEFAULT_WORKSPACE);
  state.templates.push(template);
  return state;
}

test("BW-SYNC SO v2: valid slots and opposite relation persist without altering coordinates", () => {
  const original = stateWith();
  const saved = normalizeAndValidateWorkspaceState(original);
  assert.deepEqual(saved.templates.at(-1).soSpec, original.templates.at(-1).soSpec);
});

test("BW-SYNC SO v2: legacy relation-only templates remain readable", () => {
  const state = stateWith();
  state.templates.pop();
  assert.doesNotThrow(() => normalizeAndValidateWorkspaceState(state));
});

test("BW-SYNC SO v2: invalid route, phase, direction, duplicates and missing placements fail before SQLite/D1", () => {
  const mutations = [
    (t) => { t.soSpec.directPlacements[0].routeIndex = -1; },
    (t) => { t.soSpec.directPlacements[0].routeIndex = 0.5; },
    (t) => { t.soSpec.directPlacements[1].routeIndex = 2; },
    (t) => { t.soSpec.directPlacements[0].phase = 0.25; },
    (t) => { t.soSpec.directPlacements[1].phase = -0.5; },
    (t) => { t.soSpec.directPlacements[1].phase = null; },
    (t) => { t.soSpec.directPlacements[0].direction = "backwards"; },
    (t) => { t.soSpec.directPlacements.push({ ...t.soSpec.directPlacements[0] }); },
    (t) => { t.soSpec.directPlacements = []; },
    (t) => { t.soSpec.chain = ["single", "unknown"]; },
    (t) => { t.soSpec.schemaVersion = "so-direct.v1"; },
    (t) => { delete t.soSpec.schemaVersion; },
  ];
  for (const mutate of mutations) {
    const state = stateWith();
    mutate(state.templates.at(-1));
    assert.throws(() => normalizeAndValidateWorkspaceState(state), /so-direct-workspace-validation|SO slot/, mutate.toString());
  }
});

test("BW-SYNC SO v2: persisted relation, numeric code and generator composition match actual placed vehicles", () => {
  const mutations = [
    (t) => { t.soSpec.relations = ["same"]; },
    (t) => { t.values = [0]; },
    (t) => { t.soSpec.generatorCounts.single = 2; },
    (t) => { t.soSpec.relations = []; },
  ];
  for (const mutate of mutations) {
    const state = stateWith();
    mutate(state.templates.at(-1));
    assert.throws(() => normalizeAndValidateWorkspaceState(state), /do not match/, mutate.toString());
  }
});

test("BW-SYNC SO v2: hidden vehicle identity, type, and physical slot metadata cannot masquerade as anonymous authoring", () => {
  const mutations = [
    (t) => { t.soSpec.directPlacements[0].typeId = "storm"; },
    (t) => { t.soSpec.directPlacements[0].vehicleId = 101; },
    (t) => { t.soSpec.directPlacements[0].slotId = "other-source"; },
    (t) => { t.soSpec.directPlacements[0].phaseOffset = 0.5; },
    (t) => { t.soSpec.singleCounts = { storm: 1 }; },
    (t) => { t.soSpec.doubleCounts = { lightning: 1 }; },
    (t) => { t.soSpec.singleCounts = []; },
  ];
  for (const mutate of mutations) {
    const state = stateWith();
    mutate(state.templates.at(-1));
    assert.throws(() => normalizeAndValidateWorkspaceState(state), /anonymous|type counters/, mutate.toString());
  }
});

test("BW-SYNC SO v2: direction is part of the physical placement and is retained without inferring vehicle types", () => {
  const state = stateWith();
  state.templates.at(-1).soSpec.directPlacements[1].direction = "reverse";
  // For phases 0 and 0.5, reverse leaves the semantic opposite-quarter relation unchanged.
  const normalized = normalizeAndValidateWorkspaceState(state);
  assert.equal(normalized.templates.at(-1).soSpec.directPlacements[1].direction, "reverse");
  assert.equal(normalized.templates.at(-1).soSpec.directPlacements[1].typeId, undefined);
});
