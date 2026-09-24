import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../components/bluewolf/dashboard-app.tsx', import.meta.url), 'utf8');

test('Core-derived TEST navigation is classified by authoritative source flags and selected server', () => {
  assert.match(dashboard, /const testNavigationCore = dataMode === "influx" && coreSnapshot\?\.serverId === serverValue && coreSnapshot\.source\.kind === "python-core" && coreSnapshot\.source\.navigationOrigin === "simulation" && coreSnapshot\.source\.syntheticNavigation === true/);
  assert.doesNotMatch(dashboard, /const testNavigationCore = [^;]*runtimeDetail\.includes/);
});

test('operator header, source selector and mode badge never label TEST Core as operational live Influx', () => {
  assert.match(dashboard, /testNavigationCore \? `TEST · \$\{runtimeLabel\}` : operationalEvidenceReady \? `חי ·/);
  assert.match(dashboard, /testNavigationCore \? "TEST NAVIGATION \+ Python Core" : "InfluxDB 2 \+ Python Core"/);
  assert.match(dashboard, /testNavigationCore \? "TEST CORE" : operationalEvidenceReady \? "CORE"/);
  assert.match(dashboard, /testNavigationCore \? "TEST NAVIGATION · Python Core · לא מבצעי" : operationalEvidenceReady/);
});

test('Core-generated alerts from TEST input keep visible TEST provenance rather than live operational source claims', () => {
  assert.match(dashboard, /testNavigationCore \? "TEST NAVIGATION · Python Core" : "Python Core"/);
  assert.match(dashboard, /testNavigationCore \? "התרעות שחושבו בליבה מנתוני ניווט סינתטיים לצורכי TEST בלבד — לא נתונים מבצעיים\."/);
  assert.match(dashboard, /\{testNavigationCore \? "TEST · " : ""\}\{item\.sourceLabel\}/);
});
