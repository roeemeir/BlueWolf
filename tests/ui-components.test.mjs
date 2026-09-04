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

async function readCssTree(directory) { const entries = await readdir(directory, { withFileTypes: true }); const contents = await Promise.all(entries.map(async (entry) => { const entryPath = path.join(directory, entry.name); if (entry.isDirectory()) return readCssTree(entryPath); return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : ""; })); return contents.join("\n"); }

test("emits the Blue Wolf dashboard layout and v0.4 map styles", async () => { const css = await readCssTree(path.join(root, "dist")); assert.match(css, /\.app-shell/); assert.match(css, /\.map-stage/); assert.match(css, /\.timeline-svg/); assert.match(css, /\.developer-workspace/); assert.match(css, /\.v04-live-map/); assert.match(css, /\.v04-route-bank-map/); assert.match(css, /\.v04-root-causes/); assert.match(css, /\.v04-direction-cue/); assert.match(css, /\.dark\s*\{/); });

test("forwards progress semantics to the primitive", async () => { const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx"); const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 })); assert.match(html, /aria-valuenow="37"/); assert.match(html, /aria-valuetext="37%"/); assert.match(html, /data-state="loading"/); });

test("emits chart themes for the starter's media dark mode", async () => { const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx"); const html = renderToStaticMarkup(React.createElement(ChartStyle, { id: "contract", config: { latency: { theme: { light: "#ffffff", dark: "#000000" } } } })); assert.match(html, /\[data-chart=contract\]/); assert.match(html, /@media \(prefers-color-scheme: dark\)/); assert.doesNotMatch(html, /\.dark/); });

test("renders sidebar skeletons deterministically", async () => { const { SidebarMenuSkeleton } = await vite.ssrLoadModule("/components/ui/sidebar.tsx"); const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton)); const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton)); assert.equal(first, second); assert.match(first, /--skeleton-width:70%/); });

test("keeps the live contract on a deterministic five-second tick", async () => { const { DEFAULT_WORKSPACE, getServerScenario, scoreSeriesForServer } = await vite.ssrLoadModule("/lib/bluewolf.ts"); assert.equal(DEFAULT_WORKSPACE.settings.uiRefreshSeconds, 5); assert.equal(DEFAULT_WORKSPACE.influx.activePollSeconds, 5); assert.notEqual(getServerScenario("1").groups.so.id, getServerScenario("2").groups.so.id); assert.notDeepEqual(scoreSeriesForServer("1", 12), scoreSeriesForServer("2", 12)); });

test("limits SI pair rules to 45, 90 and 120 degrees", async () => { const { SI_ALLOWED_PAIR_ANGLES, generateSiAngleSets } = await vite.ssrLoadModule("/lib/bluewolf.ts"); assert.deepEqual([...SI_ALLOWED_PAIR_ANGLES], [45, 90, 120]); const patterns = generateSiAngleSets(5); assert.ok(patterns.length >= 3); assert.ok(patterns.length <= 6); assert.ok(patterns.every((values) => values.length === 10)); assert.ok(patterns.every((values) => values.every((value) => SI_ALLOWED_PAIR_ANGLES.includes(value)))); });

test("separates servers from arenas in workspace state", async () => { const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts"); assert.ok(DEFAULT_WORKSPACE.arenas.length >= 3); assert.ok(DEFAULT_WORKSPACE.servers.every((server) => !("arena" in server))); const dashboard = await readFile(path.join(root, "components/bluewolf/dashboard-app.tsx"), "utf8"); assert.doesNotMatch(dashboard, /item\.name\}\s*·\s*\{item\.arena/); assert.match(dashboard, /בחירת מקור אינה משנה שרת או זירה/); });

test("defines SO as an exact 30 degree open smile with a real double route", async () => { const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts"); const template = DEFAULT_WORKSPACE.templates.find((item) => item.id === "tpl-so-h"); assert.deepEqual(template.soSpec.chain, ["single", "double", "single"]); assert.deepEqual(template.soSpec.relations, ["opposite", "same"]); const visuals = await readFile(path.join(root, "components/bluewolf/visuals.tsx"), "utf8"); assert.match(visuals, /Exact axes: -45°, -15°, \+15°, \+45°/); assert.match(visuals, /doublePoint/); assert.match(visuals, /RelationBadge/); assert.match(visuals, /DirectionCue/); });

test("live vehicles use group colors and heading-oriented markers without radar dots", async () => { const visuals = await readFile(path.join(root, "components/bluewolf/visuals.tsx"), "utf8"); assert.match(visuals, /heading=\{point\.heading\}/); assert.match(visuals, /color=\{groupLineColor\.si\}/); assert.match(visuals, /color=\{groupLineColor\.so\}/); assert.doesNotMatch(visuals, /vehicle-radar/); });

test("template override supports applying from current event start", async () => { const operator = await readFile(path.join(root, "components/bluewolf/operator-view.tsx"), "utf8"); assert.match(operator, /event-start/); assert.match(operator, /מתחילת האירוע/); assert.match(operator, /templateApplications/); });

test("investigation is based on group continuity and aggregated root causes", async () => { const investigation = await readFile(path.join(root, "components/bluewolf/investigation-view.tsx"), "utf8"); assert.match(investigation, /אירוע מוגדר כרצף/); assert.match(investigation, /sharePct/); assert.match(investigation, /impactPoints/); assert.match(investigation, /contribution/); assert.match(investigation, /EventOverviewMap/); assert.match(investigation, /setDraftNote/); assert.doesNotMatch(investigation, /updateEdit/); });

test("uses discrete threshold grids instead of free numeric threshold inputs", async () => { const developer = await readFile(path.join(root, "components/bluewolf/developer-view.tsx"), "utf8"); assert.match(developer, /v04-threshold-grid/); assert.doesNotMatch(developer, /type="number"/); assert.match(developer, /SI_ALLOWED_PAIR_ANGLES/); assert.match(developer, /SO_RELATION_LABELS/); });

test("developer flow includes GT playback and one-map editable route bank", async () => { const developer = await readFile(path.join(root, "components/bluewolf/developer-view.tsx"), "utf8"); assert.match(developer, /GtPlayback/); assert.match(developer, /v04-player-controls/); assert.match(developer, /RouteBankMap/); assert.match(developer, /גרור את הנתיב עצמו על המפה/); assert.match(developer, /בדיקות מערכת לפי פונקציונליות/); });

test("defines a complete Influx field mapping contract", async () => { const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule("/lib/bluewolf.ts"); const mappings = DEFAULT_WORKSPACE.influx.mappings; const vehicleId = mappings.find((item) => item.systemKey === "uniqueVehicleId"); const active = mappings.find((item) => item.systemKey === "active"); assert.ok(mappings.every((item) => item.bucket && item.measurement && item.key)); assert.equal(vehicleId.fillMode, "forward-fill"); assert.equal(active.valueMode, "special"); assert.equal(active.sourceValue, "green"); assert.equal(active.mappedValue, "true"); });