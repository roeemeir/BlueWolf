import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const developer = readFileSync(`${root}/components/bluewolf/developer-governance-workbench.tsx`, "utf8");
const general = readFileSync(`${root}/components/bluewolf/general-settings-workbench.tsx`, "utf8");

test("developer has separate QA, score and general settings tabs with no fake legacy QA surface", () => {
  for (const tab of ["qa", "score", "settings"]) assert.ok(developer.includes(`<TabsTrigger value="${tab}">`));
  assert.match(developer, /<TabsContent value="qa"><QaTruthWorkbench \/><\/TabsContent>/);
  assert.match(developer, /<TabsContent value="score"><div className="governed-score-only"><DeveloperView \/><\/div><\/TabsContent>/);
  assert.match(developer, /<TabsContent value="settings"><GeneralSettingsWorkbench \/><WorkspaceRecoveryWorkbench \/><\/TabsContent>/);
  assert.match(developer, /\.governed-score-only \.developer-nav\{display:none!important\}/);
  assert.equal((developer.match(/<QaTruthWorkbench/g) ?? []).length, 1);
  assert.doesNotMatch(developer, /<TabsTrigger value="system"/);
});

test("vehicle ranges are configured within general settings, never a separate competing developer tab", () => {
  assert.match(general, /<VehicleRangeWorkbench \/>/);
  assert.doesNotMatch(developer, /<TabsTrigger value="vehicles"/);
  assert.doesNotMatch(developer, /<VehicleRangeWorkbench \/>/);
  assert.match(general, /servers: servers\.map/);
  assert.match(general, /arenas: normalizedArenas/);
  assert.match(general, /if \(!persisted\)/);
});
