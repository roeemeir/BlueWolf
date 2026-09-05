import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readCssTree(entryPath);
    return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
  }));
  return contents.join("\n");
}

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("emits the Blue Wolf dashboard, map, timeline and developer styles", async () => {
  const css = await readCssTree(path.join(root, "dist"));
  assert.match(css, /\.app-shell/);
  assert.match(css, /\.map-stage/);
  assert.match(css, /\.timeline-svg/);
  assert.match(css, /\.developer-workspace/);
  assert.match(css, /\.v04-live-map/);
  assert.match(css, /\.v04-route-bank-map/);
  assert.match(css, /\.dark\s*\{/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));
  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule("/components/ui/sidebar.tsx");
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  assert.equal(first, second);
});

test("keeps the live contract on a deterministic five-second source tick", async () => {
  const { DEFAULT_WORKSPACE, getServerScenario, scoreSeriesForServer } = await vite.ssrLoadModule("/lib/bluewolf.ts");
  assert.equal(DEFAULT_WORKSPACE.settings.uiRefreshSeconds, 5);
  assert.equal(DEFAULT_WORKSPACE.influx.activePollSeconds, 5);
  assert.notEqual(getServerScenario("1").groups.so.id, getServerScenario("2").groups.so.id);
  assert.notDeepEqual(scoreSeriesForServer("1", 12), scoreSeriesForServer("2", 12));
});

test("limits SI builder angles to 45, 90 and 120 degrees", async () => {
  const { SI_ALLOWED_PAIR_ANGLES, generateSiAngleSets } = await vite.ssrLoadModule("/lib/bluewolf.ts");
  assert.deepEqual([...SI_ALLOWED_PAIR_ANGLES], [45, 90, 120]);
  for (const vehicleCount of [2, 3, 4, 5]) {
    const patterns = generateSiAngleSets(vehicleCount);
    assert.ok(patterns.length >= 1);
    assert.ok(patterns.every((values) => values.length === vehicleCount - 1));
    assert.ok(patterns.every((values) => values.every((value) => SI_ALLOWED_PAIR_ANGLES.includes(value))));
  }
});

test("keeps server selection separate from arena metadata", async () => {
  const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
  assert.ok(DEFAULT_WORKSPACE.arenas.length >= 1);
  assert.ok(DEFAULT_WORKSPACE.servers.every((server) => !("arena" in server)));
  const dashboard = await source("components/bluewolf/dashboard-app.tsx");
  const operator = await source("components/bluewolf/operator-view.tsx");
  assert.match(dashboard, /בחירת מקור אינה משנה שרת או זירה/);
  assert.doesNotMatch(operator, /setArena|v04-arena-select/);
  assert.match(operator, /ללא תלות בזירה/);
});

test("renders authoritative SO geometry as a continuous double route and never a fixed smile", async () => {
  const visuals = await source("components/bluewolf/visuals.tsx");
  assert.match(visuals, /doubleHippodromeLoop/);
  assert.match(visuals, /v08-continuous-double/);
  assert.match(visuals, /יחיד — כפול רציף — יחיד/);
  assert.doesNotMatch(visuals, /Exact axes|30° מדויק|· 30°|doublePoint|open smile/);
});

test("live vehicle markers preserve physical heading, group color and five-second trace dots", async () => {
  const visuals = await source("components/bluewolf/visuals.tsx");
  assert.match(visuals, /heading=\{point\.heading\}/);
  assert.match(visuals, /color=\{groupLineColor\.si\}/);
  assert.match(visuals, /color=\{groupLineColor\.so\}/);
  assert.match(visuals, /traceDots/);
  assert.match(visuals, /\* 5 \/ 74/);
  assert.match(visuals, /v08-trace-dots/);
  assert.doesNotMatch(visuals, /vehicle-radar/);
});

test("live SI overlay computes all pairwise angles", async () => {
  const visuals = await source("components/bluewolf/visuals.tsx");
  assert.match(visuals, /siPoints\.flatMap/);
  assert.match(visuals, /Math\.min\(raw, 360 - raw\)/);
});

test("timeline follows the SRS line-style contract", async () => {
  const visuals = await source("components/bluewolf/visuals.tsx");
  const operator = await source("components/bluewolf/operator-view.tsx");
  assert.match(visuals, /total: \{ width: 4\.2, opacity: 1 \}/);
  assert.match(visuals, /sync: \{ width: 2\.4, dash: "10 6"/);
  assert.match(visuals, /route: \{ width: 2\.2, dash: "2 7"/);
  assert.match(operator, /\[30, 60, 90, 120\]/);
  assert.match(operator, /ציר זמן משותף/);
});

test("template override exposes expected scores and both application scopes", async () => {
  const operator = await source("components/bluewolf/operator-view.tsx");
  assert.match(operator, /כולל צפוי/);
  assert.match(operator, /סנכרון צפוי/);
  assert.match(operator, /נתיב צפוי/);
  assert.match(operator, /אומדן דטרמיניסטי/);
  assert.match(operator, /event-start/);
  assert.match(operator, /מתחילת האירוע/);
  assert.match(operator, /templateApplications/);
});

test("operator mute contract includes restart, 5, 15 and 30 minutes", async () => {
  const operator = await source("components/bluewolf/operator-view.tsx");
  for (const value of ["restart", "5", "15", "30"]) assert.match(operator, new RegExp(`value=\\"${value}\\"`));
  assert.match(operator, /ההתראה החזותית נשארת פעילה/);
});

test("uses discrete threshold grids instead of free numeric threshold inputs", async () => {
  const developer = await source("components/bluewolf/developer-view.tsx");
  assert.match(developer, /v04-threshold-grid/);
  assert.doesNotMatch(developer, /type="number"/);
  assert.match(developer, /SI_ALLOWED_PAIR_ANGLES/);
});

test("developer SO builder has no fixed-angle smile law", async () => {
  const developer = await source("components/bluewolf/developer-view.tsx");
  assert.doesNotMatch(developer, /קצה משותף · 30°|30° מדויק|SO · חיוך/);
  assert.match(developer, /ללא זווית גיאומטרית קשיחה/);
  assert.match(developer, /SO_RELATION_LABELS/);
  assert.match(developer, /mixed רק ליד Double/);
});

test("developer flow keeps GT, route bank, Influx mapping and system-test surfaces", async () => {
  const developer = await source("components/bluewolf/developer-view.tsx");
  assert.match(developer, /GtPlayback/);
  assert.match(developer, /v04-player-controls/);
  assert.match(developer, /RouteBankMap/);
  assert.match(developer, /InfluxDB 2/);
  assert.match(developer, /בדיקות מערכת לפי פונקציונליות/);
});

test("defines a complete Influx field mapping contract", async () => {
  const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts");
  const mappings = DEFAULT_WORKSPACE.influx.mappings;
  const vehicleId = mappings.find((item) => item.systemKey === "uniqueVehicleId");
  const active = mappings.find((item) => item.systemKey === "active");
  assert.ok(mappings.every((item) => item.bucket && item.measurement && item.key));
  assert.equal(vehicleId.fillMode, "forward-fill");
  assert.equal(active.valueMode, "special");
  assert.equal(active.sourceValue, "green");
  assert.equal(active.mappedValue, "true");
});

test("investigation keeps Events separate from Alerts and uses saved-position retrospective map", async () => {
  const investigation = await source("components/bluewolf/investigation-view.tsx");
  assert.match(investigation, /sharePct/);
  assert.match(investigation, /impactPoints/);
  assert.match(investigation, /contribution/);
  assert.match(investigation, /RetrospectiveMap/);
  assert.match(investigation, /route\.mapX/);
  assert.match(investigation, /route\.mapY/);
  assert.match(investigation, /draftEdits/);
  assert.doesNotMatch(investigation, /SO · 30°|alertHistory|activeAlert/);
});

test("the checked-in SRS carries the no-regression release doctrine", async () => {
  const srs = await source("docs/BLUE_WOLF_SRS.md");
  for (const id of ["SRS-0002", "SRS-0306", "SRS-0501", "SRS-1109", "SRS-1308", "SRS-1402", "SRS-1701", "SRS-2407", "SRS-2701", "SRS-2805"]) {
    assert.match(srs, new RegExp(id));
  }
  assert.match(srs, /Groups = Geometry \+ Period/);
  assert.match(srs, /Alert and Event are different domain entities/);
});
