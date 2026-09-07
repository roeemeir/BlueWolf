import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInfluxRecords } from "../lib/influx-navigation.ts";

const MAPPINGS = [
  { systemKey: "uniqueVehicleId", valueMode: "direct" },
  { systemKey: "latitude", valueMode: "direct" },
  { systemKey: "longitude", valueMode: "direct" },
  { systemKey: "velocityNorth", valueMode: "direct" },
  { systemKey: "velocityEast", valueMode: "direct" },
];

function recordsFor(mapping, vehicleCount = 8, samplesPerVehicle = 1750) {
  const records = [];
  const base = Date.parse("2026-09-06T00:00:00.000Z");
  for (let vehicle = 0; vehicle < vehicleCount; vehicle += 1) {
    const vehicleId = 101 + vehicle;
    const tags = { server_id: "1", vehicle: String(vehicleId) };
    for (let index = 0; index < samplesPerVehicle; index += 1) {
      const time = new Date(base + index * 50_000).toISOString();
      let value;
      if (mapping.systemKey === "uniqueVehicleId") value = String(vehicleId);
      else if (mapping.systemKey === "latitude") value = String(31.7 + vehicle * 0.0001 + index * 1e-8);
      else if (mapping.systemKey === "longitude") value = String(34.8 + vehicle * 0.0001 + index * 1e-8);
      else if (mapping.systemKey === "velocityNorth") value = String(10 + Math.sin(index / 20));
      else value = String(3 + Math.cos(index / 20));
      records.push({ systemKey: mapping.systemKey, time, value, tags });
    }
  }
  return records;
}

test("post-Flux 24h join budget stays comfortably below end-to-end minute target", () => {
  const input = MAPPINGS.map((mapping) => ({ mapping, records: recordsFor(mapping) }));
  const rawRecords = input.reduce((sum, item) => sum + item.records.length, 0);
  assert.equal(rawRecords, 70_000);

  const started = performance.now();
  const normalized = normalizeInfluxRecords(input, 5);
  const elapsedMs = performance.now() - started;

  assert.equal(normalized.samples.length, 14_000);
  assert.ok(elapsedMs < 5_000, `70k field records -> 14k NAV samples join took ${(elapsedMs / 1000).toFixed(2)}s`);
});
