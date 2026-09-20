import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const stylesheet = read("app/mobile-map-influx.css");
const layout = read("app/layout.tsx");
const simulation = read("components/bluewolf/so-governed-visuals.tsx");
const core = read("components/bluewolf/operational-live-map.tsx");

for (const [name, source] of [["SIM", simulation], ["Core", core]]) {
  test(`${name} renders five independent layer filter controls and actual SVG visibility gates`, () => {
    const routeLabel = name === "SIM" ? "נתיב מזוהה (SIM: תרחיש, לא Core)" : "נתיב מזוהה";
    for (const label of ["עקבה נצפית", "עקבה לפי ציון", routeLabel, "קבוצות", "תבנית"]) {
      assert.ok(source.includes(`>${label}</button>`), `${name}: missing ${label}`);
    }
    if (name === "SIM") {
      assert.match(source, /data-sim-navigation-source="synthetic-sim-navigation"/);
      assert.match(source, /SIM · GPS סינתטי עם רעש, רוח וחורי מדידה; לא תצפיות Core/);
    } else {
      assert.doesNotMatch(source, /data-sim-navigation-source/);
    }
    for (const layer of ["observed-trace", "score-trace"]) assert.ok(source.includes(`className="${layer}"`), `${name}: missing ${layer} SVG layer`);
    assert.match(source, /onClick=\{\(\) => set(?:ShowObservedTrace|ObservedLayer)/);
  });
}

test("mobile stylesheet is globally loaded and keeps map filters touchable with active/focus states", () => {
  assert.match(layout, /import "\.\/mobile-map-influx\.css"/);
  assert.match(stylesheet, /\.v04-operator \.v04-map-layer-controls button\.active/);
  assert.match(stylesheet, /\.v04-operator \.v04-map-layer-controls button:focus-visible/);
  assert.match(stylesheet, /touch-action:\s*manipulation/);
  assert.match(stylesheet, /@media \(max-width: 760px\)/);
  assert.match(stylesheet, /min-height:\s*44px/);
});

test("Influx mobile forms override desktop inline multi-column grids without overriding desktop", () => {
  assert.match(stylesheet, /\[data-testid="influx-governance-workbench"\] article > div\[style\*="grid-template-columns"\]/);
  assert.match(stylesheet, /grid-template-columns:\s*minmax\(0, 1fr\) !important/);
  assert.match(stylesheet, /\[data-testid="influx-governance-workbench"\] input \{/);
  assert.match(stylesheet, /font-size:\s*16px/);
});
