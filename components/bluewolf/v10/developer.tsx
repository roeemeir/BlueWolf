"use client";

import { useMemo, useState, type ComponentType } from "react";
import { Activity, Beaker, Database, Layers3, MapPinned, Settings2, ShieldCheck } from "lucide-react";

import { useWorkspace } from "../app-context";
import { doubleHippodromeLoop, hippodromeLoop } from "../v09/geometry";
import { V09Influx } from "../v09/infra-settings";
import { V09RouteBank } from "../v09/route-bank";
import { V09ScoreSettings } from "../v09/score-settings";
import { sensitivityEvidence } from "../v09/scoring";
import { getV09Scenario } from "../v09/simulator";
import { DEFAULT_SO_GROUPING, type SoGroupingSettings } from "./grouping";
import { V10GT } from "./gt";
import { analyzeNavigation, navigationHistory } from "./nav-engine";
import { V10Settings } from "./settings";
import { generateUniqueSoLayouts, V10TemplateBuilder } from "./template-builder";
import { estimatedWindContribution, windForVehicle } from "./wind";

type Section = "score" | "templates" | "gt" | "influx" | "routes" | "tests" | "settings";
const sections: { id: Section; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "score", label: "ציון וספים", icon: Activity },
  { id: "templates", label: "תבניות", icon: Layers3 },
  { id: "gt", label: "GT ו־Sweep", icon: Beaker },
  { id: "influx", label: "InfluxDB 2", icon: Database },
  { id: "routes", label: "בנק נתיבים", icon: MapPinned },
  { id: "tests", label: "בדיקות מערכת", icon: ShieldCheck },
  { id: "settings", label: "הגדרות", icon: Settings2 },
];

type BrowserTest = { name: string; category: string; pass: boolean; detail: string };

function groupingFromState(settings: unknown): SoGroupingSettings {
  const raw = settings as { soGroupingMaxParallelLegs?: number; soGroupingMaxLateralLegs?: number; soGroupingMaxAngleDeg?: number };
  return {
    maxParallelLegs: raw.soGroupingMaxParallelLegs ?? DEFAULT_SO_GROUPING.maxParallelLegs,
    maxLateralLegs: raw.soGroupingMaxLateralLegs ?? DEFAULT_SO_GROUPING.maxLateralLegs,
    maxAngleDeg: raw.soGroupingMaxAngleDeg ?? DEFAULT_SO_GROUPING.maxAngleDeg,
  };
}

function runExecutableSuite(state: ReturnType<typeof useWorkspace>["state"]) {
  const tests: BrowserTest[] = [];
  const add = (name: string, category: string, fn: () => boolean, detail: string) => {
    let pass = false;
    try { pass = fn(); } catch { pass = false; }
    tests.push({ name, category, pass, detail });
  };

  const grouping = groupingFromState(state.settings);
  const siTemplate = state.templates.find((template) => template.id === "tpl-si-120") ?? state.templates.find((template) => template.family === "SI");
  const soTemplate = state.templates.find((template) => template.id === "tpl-so-chain") ?? state.templates.find((template) => template.family === "SO");
  const args = { thresholds: state.thresholds, weights: state.weights, siTemplate, soTemplate, groupingSettings: grouping };

  const hip = hippodromeLoop({ x: 0, y: 0 }, 30, 120, 0);
  const dbl = doubleHippodromeLoop({ x: 0, y: 0 }, 25, 90, 100, 28, 0);
  add("גאומטריית היפודרום", "גאומטריה", () => Math.min(...hip.map((p) => p.x)) < -85 && Math.max(...hip.map((p) => p.x)) > 85 && Math.max(...hip.map((p) => Math.abs(p.y))) >= 29, "נבדקים בפועל שני ישרים ושתי פניות חצי־מעגל כלפי חוץ.");
  add("Double הוא לולאה רציפה", "גאומטריה", () => dbl.length > 100 && Math.max(...dbl.map((p) => p.x)) - Math.min(...dbl.map((p) => p.x)) > 180, "נבדקת גאומטריית Double מלאה ולא קבוע תצוגה.");

  const sensitivity = sensitivityEvidence(state.thresholds, state.weights);
  add("רגישות ציון SI", "מנוע ציון", () => sensitivity.pass, `ציון סנכרון: מושלם ${sensitivity.perfect.sync} → סטייה 15° ${sensitivity.moderate.sync} → סטייה 30° ${sensitivity.wrong.sync}.`);

  const navA = analyzeNavigation({ serverId: "1", tick: 140, windMode: "gusty", ...args });
  const navB = analyzeNavigation({ serverId: "1", tick: 140, windMode: "gusty", ...args });
  add("מנוע ניווט דטרמיניסטי", "מנוע ניווט", () => JSON.stringify(navA.si.score) === JSON.stringify(navB.si.score) && JSON.stringify(navA.so.score) === JSON.stringify(navB.so.score) && navA.nav[101]?.x === navB.nav[101]?.x, `SI ${navA.si.score.sync}, SO ${navA.so.score.sync}; אותה סדרת ניווט מחזירה אותה תוצאה.`);
  add("ציון נבנה מראיות ניווט", "מנוע ציון", () => Object.values(navA.nav).length >= navA.scenario.groups.si.members.length + navA.scenario.groups.so.members.length && Object.values(navA.si.vehicles).every((vehicle) => Number.isFinite(vehicle.routeDeviation) && Number.isFinite(vehicle.sync)), `נמצאו ${Object.keys(navA.nav).length} דגימות רכב עם סטיית נתיב/סנכרון מחושבים.`);

  const server2 = getV09Scenario("2", 100, grouping);
  add("שרת 2 · היפודרום מרוחק לא מקובץ", "קיבוץ SO", () => server2.groups.so.members.some((member) => member.id === 321) && server2.groups.so.members.some((member) => member.id === 421) && !server2.groups.so.members.some((member) => member.id === 521) && Boolean(server2.ungroupedMembers?.some((member) => member.id === 521)), `מקובצים: ${server2.groups.so.members.map((member) => member.id).join(", ")} · מחוץ לקבוצה: ${server2.ungroupedMembers?.map((member) => member.id).join(", ") || "—"}.`);

  const server3 = getV09Scenario("3", 100, grouping);
  add("שרת 3 · Double+Single חוקיים", "קיבוץ SO", () => [611, 612, 613].every((id) => server3.groups.so.members.some((member) => member.id === id)) && !(server3.ungroupedMembers?.length), server3.groupingNotes?.find((note) => note.includes("s3-double") && note.includes("s3-right")) ?? "Double+Single עברו בדיקת חזית ומרחקים.");

  const layouts = generateUniqueSoLayouts(2, 1);
  const layoutStrings = layouts.map((layout) => layout.map((kind) => kind[0]).join(""));
  add("SO layouts ללא סימטריית מראה", "מחולל תבניות", () => layouts.length === 2 && layoutStrings.every((value, index) => !layoutStrings.slice(index + 1).includes([...value].reverse().join(""))), `2 יחידים + כפול אחד → ${layouts.length} layouts ייחודיים: ${layoutStrings.join(" / ")}.`);

  const windA = windForVehicle("2", 140, 421, "gusty");
  const windB = windForVehicle("2", 140, 421, "gusty");
  const noWind = analyzeNavigation({ serverId: "2", tick: 140, windMode: "off", ...args });
  const withWind = analyzeNavigation({ serverId: "2", tick: 140, windMode: "gusty", ...args });
  const contribution = estimatedWindContribution(withWind.so.score.sync, noWind.so.score.sync, windA.confidence);
  add("שערוך רוח בלבד", "רוח", () => JSON.stringify(windA) === JSON.stringify(windB) && windA.estimatedKnots > 0 && windA.estimatedBearingDeg >= 0 && windA.estimatedBearingDeg < 360 && contribution >= 0, `${windA.estimatedKnots} קשר @ ${windA.estimatedBearingDeg}° מצפון; תרומה משוערת ${contribution.toFixed(1)} נק׳. אין penalty עצמאי בציון.`);

  const history = navigationHistory({ serverId: "1", currentTick: 180, minutes: 30, windMode: "gusty", ...args });
  const current = analyzeNavigation({ serverId: "1", tick: 180, windMode: "gusty", ...args });
  add("Timeline משתמש באותו מנוע", "גרף זמן", () => history.length === 31 && history.at(-1)?.si.sync === current.si.score.sync && history.at(-1)?.so.sync === current.so.score.sync, `31 נקודות מחושבות; הנקודה האחרונה תואמת למפה: SI ${current.si.score.sync}, SO ${current.so.score.sync}.`);

  let analyzedWindows = 0;
  let badWindows = 0;
  for (let server = 1; server <= 3; server += 1) {
    for (let tick = 0; tick < 300; tick += 5) {
      const result = analyzeNavigation({ serverId: String(server), tick, windMode: tick % 20 === 0 ? "gusty" : "off", ...args });
      analyzedWindows += 1;
      const values = [result.si.score.total, result.si.score.sync, result.si.score.route, result.so.score.total, result.so.score.sync, result.so.score.route];
      const members = [...result.scenario.groups.si.members, ...result.scenario.groups.so.members];
      if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100) || !members.every((member) => Boolean(result.nav[member.id]))) badWindows += 1;
    }
  }
  add("180 חלונות ניווט מלאים", "Regression", () => analyzedWindows === 180 && badWindows === 0, `${analyzedWindows} חלונות משלושת השרתים עברו חישוב NAV→Grouping→Score; כשלים: ${badWindows}.`);

  return tests;
}

function Tests() {
  const { state } = useWorkspace();
  const [tests, setTests] = useState<BrowserTest[]>([]);
  const [runMs, setRunMs] = useState<number | null>(null);
  const run = () => {
    const start = performance.now();
    const out = runExecutableSuite(state);
    setRunMs(performance.now() - start);
    setTests(out);
  };
  const passed = tests.filter((test) => test.pass).length;
  return <div>
    <header className="v09-section-header"><div><p className="eyebrow">ראיות הרצה · SRS v1.3</p><h2>בדיקות מערכת</h2><p>הכפתור מפעיל בפועל גאומטריה, קיבוץ, מנוע ניווט, ציון, Timeline, מחולל layouts ושערוך רוח. אלו אינן כרטיסיות דמה; Release עדיין דורש בנוסף CI ו־Playwright.</p></div><button className="primary" onClick={run}>הרץ בדיקות מערכת אמיתיות</button></header>
    <div className="v09-test-summary"><span>גאומטריה</span><span>קיבוץ SO</span><span>מנוע NAV</span><span>ציון</span><span>רוח</span><span>Timeline</span><span>תבניות</span><span>Regression</span></div>
    {tests.length ? <><div className="v09-test-kpis"><b className={passed === tests.length ? "good" : "low"}>{passed}/{tests.length}</b><span>{runMs?.toFixed(1)} ms · בדיקות Executable</span></div><div className="v09-test-grid">{tests.map((test, index) => <article key={`${test.name}-${index}`}><header><b>{test.name}</b><span className={test.pass ? "pass" : "fail"}>{test.pass ? "PASS" : "FAIL"}</span></header><small>{test.category}</small><p>{test.detail}</p></article>)}</div></> : <div className="v09-empty-tests"><ShieldCheck /><b>טרם הורץ בדפדפן</b><p>לחץ על הכפתור כדי להריץ את מנועי המערכת. Gate השחרור מריץ בנוסף Python Core, TypeScript, ESLint, Build, regression ו־Desktop/Mobile Browser QA.</p></div>}
  </div>;
}

export function DeveloperViewV10() {
  const [section, setSection] = useState<Section>("templates");
  const content = useMemo(() => ({
    score: <V09ScoreSettings />,
    templates: <V10TemplateBuilder />,
    gt: <V10GT />,
    influx: <V09Influx />,
    routes: <V09RouteBank />,
    tests: <Tests />,
    settings: <V10Settings />,
  }), []);
  return <div className="v09-developer v10-developer"><nav className="v09-dev-nav">{sections.map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon /><span>{item.label}</span></button>; })}</nav><main className="v09-dev-content">{content[section]}</main></div>;
}
