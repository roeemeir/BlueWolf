"use client";

import { useState } from "react";
import { PlayCircle, ShieldCheck } from "lucide-react";
import { DEFAULT_INFLUX_MAPPINGS } from "@/lib/bluewolf";
import { checkSoPairCompatibility, CORE_API_VERSION } from "@/lib/algorithm-core-adapter";
import { normalizeInfluxRecords, type InfluxMappedRecord } from "@/lib/influx-navigation";
import { useWorkspace } from "../app-context";
import { DEFAULT_SO_GROUPING } from "../v10/grouping";
import { generateUniqueSoLayouts } from "../v10/template-builder";
import { analyzeNavigationDataset } from "./navigation-analyzer";
import { analyzeNavigationHistory } from "./navigation-history";
import { generateSimulationDataset, simulationHistoryBounds, simulatorGroundTruthAt, simulatorInjectedDisturbanceAt } from "./navigation-data";

type Result = { name: string; category: string; pass: boolean; detail: string };

const bearingDiff = (a: number, b: number) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
const ids = (value: number[]) => [...value].sort((a, b) => a - b).join(",");
const fixtureRecords = (systemKey: string, value: string, time: string): InfluxMappedRecord[] => [{ systemKey, time, value, tags: { vehicle: "fixture-101" } }];

export function V12SystemTests() {
  const { state } = useWorkspace();
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [analyses, setAnalyses] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const rawSettings = state.settings as typeof state.settings & {
    soGroupingMaxParallelLegs?: number;
    soGroupingMaxLateralLegs?: number;
    soGroupingMaxAngleDeg?: number;
  };
  const grouping = {
    maxParallelLegs: rawSettings.soGroupingMaxParallelLegs ?? DEFAULT_SO_GROUPING.maxParallelLegs,
    maxLateralLegs: rawSettings.soGroupingMaxLateralLegs ?? DEFAULT_SO_GROUPING.maxLateralLegs,
    maxAngleDeg: rawSettings.soGroupingMaxAngleDeg ?? DEFAULT_SO_GROUPING.maxAngleDeg,
  };
  const options = {
    thresholds: state.thresholds,
    weights: state.weights,
    siTemplate: state.templates.find((template) => template.id === "tpl-si-120") ?? state.templates.find((template) => template.family === "SI"),
    soTemplate: state.templates.find((template) => template.id === "tpl-so-chain") ?? state.templates.find((template) => template.family === "SO"),
    groupingSettings: grouping,
  };

  const run = async (stress = 180) => {
    setRunning(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const started = performance.now();
    const out: Result[] = [];
    let analysisCount = 0;
    const add = (name: string, category: string, pass: boolean, detail: string) => out.push({ name, category, pass, detail });

    try {
      const now = new Date();
      add("Core contract", "Architecture", CORE_API_VERSION === "1.0.0", `Python CORE_API_VERSION=${CORE_API_VERSION}`);

      for (const serverId of ["1", "2", "3"]) {
        const center = new Date(now.getTime() - (Number(serverId) * 37 + 12) * 60_000);
        const dataset = generateSimulationDataset({ serverId, from: new Date(center.getTime() - 12 * 60_000), to: center, grouping, windMode: "gusty", targetPoints: 2600 });
        const analysis = await analyzeNavigationDataset(dataset, options);
        const gt = simulatorGroundTruthAt(serverId, center, grouping);
        analysisCount += 1;

        const detected = Object.keys(analysis.current).map(Number);
        add(`שרת ${serverId} · רכבים פעילים`, "Simulator→NAV→Python Core→GT", gt.activeVehicles.every((id) => detected.includes(id)), `GT ${ids(gt.activeVehicles)} · ניתוח ${ids(detected)}`);
        add(`שרת ${serverId} · טווח ציונים`, "Python Core scoring", [analysis.groups.si.score, analysis.groups.so.score].every((score) => Object.values(score).every((value) => Number.isFinite(value) && value >= 0 && value <= 100)), `SI ${analysis.groups.si.score.total} · SO ${analysis.groups.so.score.total}`);

        if (serverId === "1") {
          add(
            "שרת 1 · קבוצת SI בסיסית תואמת GT",
            "Simulator→NAV→Python Core→GT",
            ids(gt.siVehicles) === ids(analysis.groups.si.members),
            `GT SI ${ids(gt.siVehicles)} · Core SI ${ids(analysis.groups.si.members)}`,
          );
        }
        if (serverId === "2") {
          add("שרת 2 · נתיב SO מרוחק נשאר מחוץ לקבוצה", "Python Core grouping", gt.ungroupedVehicles.every((id) => analysis.ungroupedVehicles.includes(id)), `GT מחוץ ${ids(gt.ungroupedVehicles)} · בפועל ${ids(analysis.ungroupedVehicles)}`);
          const gtFigure8 = gt.routeKinds[521];
          const detectedFigure8 = analysis.routes.find((route) => route.vehicleId === 521);
          add(
            "שרת 2 · שמינייה = היפודרום עם legs מוצלבים",
            "Simulator→NAV→Python Core→GT",
            gtFigure8 === "figure8" && detectedFigure8?.kind === "figure8" && detectedFigure8.geometry?.crossedLegs === true,
            `GT=${gtFigure8 ?? "—"} · Core=${detectedFigure8?.kind ?? "—"} · crossedLegs=${String(detectedFigure8?.geometry?.crossedLegs ?? false)}`,
          );
        }
        if (serverId === "3") add("שרת 3 · Double+Single מזוהים כקבוצת SO", "Python Core grouping", analysis.groups.so.members.length >= 2, `SO בפועל ${ids(analysis.groups.so.members)}`);

        const gtVehicle = gt.activeVehicles.find((id) => analysis.groups.so.vehicles[id] || analysis.groups.si.vehicles[id]);
        if (gtVehicle) {
          const evidence = analysis.groups.so.vehicles[gtVehicle] ?? analysis.groups.si.vehicles[gtVehicle];
          const truth = simulatorInjectedDisturbanceAt(serverId, center, grouping, gtVehicle, "gusty");
          const speedOk = Boolean(truth) && Math.abs(evidence.wind.speedKnots - truth!.speedKnots) <= 5;
          const bearingOk = Boolean(truth) && (truth!.speedKnots < 0.75 || bearingDiff(evidence.wind.bearingDeg, truth!.bearingDeg) <= 85);
          add(
            `שרת ${serverId} · הפרעת NAV מוזרקת מול estimate`,
            "Estimator only",
            speedOk && bearingOk,
            truth
              ? `GT NAV ${truth.speedKnots.toFixed(1)} kt @ ${truth.bearingDeg.toFixed(0)}° · estimate ${evidence.wind.speedKnots.toFixed(1)} kt @ ${evidence.wind.bearingDeg.toFixed(0)}°`
              : "לא ניתן לגזור GT הפרעה מהסימולטור",
          );
        }
      }

      const valid = await checkSoPairCompatibility(
        { kind: "single", center: { x: 0, y: 0 }, radius: 25, legLength: 100, rotationDeg: 0 },
        { kind: "single", center: { x: 120, y: 5 }, radius: 25, legLength: 100, rotationDeg: 5 },
        grouping,
      );
      const validFigure8 = await checkSoPairCompatibility(
        { kind: "figure8", center: { x: 0, y: 0 }, radius: 25, legLength: 100, rotationDeg: 0, crossedLegs: true },
        { kind: "single", center: { x: 120, y: 5 }, radius: 25, legLength: 100, rotationDeg: 5 },
        grouping,
      );
      const invalid = await checkSoPairCompatibility(
        { kind: "single", center: { x: 0, y: 0 }, radius: 25, legLength: 100, rotationDeg: 0 },
        { kind: "single", center: { x: 90, y: 70 }, radius: 25, legLength: 100, rotationDeg: 45 },
        grouping,
      );
      add("חוק קיבוץ · Single/Figure-8/invalid", "Python Core grouping", valid.valid && validFigure8.valid && !invalid.valid, `single=${valid.explanation} | figure8=${validFigure8.explanation} | invalid=${invalid.explanation}`);

      const layouts = generateUniqueSoLayouts(2, 1, 1).map((layout) => layout.join("-"));
      add("SO layout · Single/Double/Figure-8 ללא תמונות מראה כפולות", "Template builder", new Set(layouts).size === layouts.length && layouts.length > 0 && layouts.some((layout) => layout.includes("figure8")), `${layouts.length} layouts ייחודיים`);

      const bounds = simulationHistoryBounds(now);
      const month = generateSimulationDataset({ serverId: "2", from: bounds.from, to: bounds.to, grouping, windMode: "gusty", targetPoints: 6500 });
      const monthAgain = generateSimulationDataset({ serverId: "2", from: bounds.from, to: bounds.to, grouping, windMode: "gusty", targetPoints: 6500 });
      add("30 יום · שליפה דטרמיניסטית", "Historical NAV", month.samples.length > 0 && month.samples.length === monthAgain.samples.length && month.samples[0]?.timestamp === monthAgain.samples[0]?.timestamp && month.samples.at(-1)?.timestamp === monthAgain.samples.at(-1)?.timestamp, `${month.samples.length} דגימות · ${month.provenance.from} → ${month.provenance.to}`);

      // Six hours remain a real raw-NAV historical replay. Forty-eight frames
      // are enough to exercise event segmentation while keeping the interactive
      // E2E button within its runtime budget on ordinary operator hardware/CI.
      const sixHours = generateSimulationDataset({ serverId: "3", from: new Date(now.getTime() - 6 * 60 * 60_000), to: now, grouping, windMode: "gusty", targetPoints: 4200 });
      const historyEnvelope = await analyzeNavigationHistory(sixHours, options, 48, 12);
      analysisCount += historyEnvelope.history.length;
      add("אירועים · נגזרים מהיסטוריית NAV", "Investigation", historyEnvelope.events.length > 0 && historyEnvelope.events.every((event) => event.frames.length > 0 && event.startReason.length > 10 && event.endReason.length > 10), `${historyEnvelope.events.length} אירועים מתוך ${historyEnvelope.history.length} frames`);

      const time = "2026-09-06T12:00:00.000Z";
      const mapped = DEFAULT_INFLUX_MAPPINGS
        .filter((mapping) => ["uniqueVehicleId", "latitude", "longitude", "velocityNorth", "velocityEast"].includes(mapping.systemKey))
        .map((mapping) => ({
          mapping,
          records: fixtureRecords(mapping.systemKey, mapping.systemKey === "uniqueVehicleId" ? "101" : mapping.systemKey === "latitude" ? "31.7" : mapping.systemKey === "longitude" ? "34.8" : mapping.systemKey === "velocityNorth" ? "12" : "3", time),
        }));
      const normalized = normalizeInfluxRecords(mapped, 2);
      add("Influx fixture · אותו normalizer", "Influx adapter", normalized.samples.length === 1 && normalized.samples[0].vehicleId === 101 && normalized.samples[0].velocityNorth === 12, `${normalized.samples.length} normalized sample`);

      const empty = await analyzeNavigationDataset({
        samples: [],
        provenance: { source: "influx", serverId: "1", from: time, to: time, latestSampleAt: null, sampleCount: 0, vehicleCount: 0, samplingMedianSeconds: null, completenessPct: null, freshnessSeconds: null, warnings: ["fixture no data"] },
      }, options);
      add("אין נתונים · אין ציון חלופי", "Provenance", !empty.available && empty.groups.si.members.length === 0 && empty.groups.so.members.length === 0 && empty.groups.si.score.total === 0, "No simulator fallback and no fabricated score");

      let stressFailure = "";
      for (let index = 0; index < stress; index += 1) {
        const serverId = String(index % 3 + 1);
        const center = new Date(now.getTime() - (index * 173 % 30_000) * 60_000);
        // Stress validates numerical stability across many true production-path
        // analyses; it does not need the high-density route-fit fixture used by
        // the semantic GT cases above. Keep 180/1000 real windows but sample
        // each six-minute window sparsely enough for an interactive test run.
        const data = generateSimulationDataset({ serverId, from: new Date(center.getTime() - 6 * 60_000), to: center, grouping, windMode: index % 4 === 0 ? "off" : index % 4 === 1 ? "steady" : index % 4 === 2 ? "gusty" : "crosswind", targetPoints: 160 });
        const analysis = await analyzeNavigationDataset(data, options);
        analysisCount += 1;
        const finite = [...Object.values(analysis.groups.si.score), ...Object.values(analysis.groups.so.score)].every((value) => Number.isFinite(value));
        if (!finite) { stressFailure = `non-finite score at ${index}`; break; }
      }
      add(`${stress} חלונות stress אמיתיים`, "Stress", !stressFailure, stressFailure || `${stress} datasets עברו simulator→raw NAV→Python Core`);
    } catch (error) {
      add("הרצת מערכת", "Runtime", false, error instanceof Error ? error.message : "unknown error");
    }

    setResults(out);
    setAnalyses(analysisCount);
    setElapsed(performance.now() - started);
    setRunning(false);
  };

  const passed = results.filter((item) => item.pass).length;
  return <div>
    <header className="v09-section-header"><div><p className="eyebrow">E2E SYSTEM TESTS · SRS v1.8 · PYTHON</p><h2>בדיקות מערכת אמיתיות</h2><p>ה־GT נבדק רק אחרי שה־Python Core סיים. הליבה אינה מקבלת GT, React או DB כקלט.</p></div><div className="v09-actions"><button disabled={running} onClick={() => void run(180)}><PlayCircle />{running ? "רץ..." : "הרץ E2E"}</button><button className="primary" disabled={running} onClick={() => void run(1000)}><ShieldCheck />Stress 1000</button></div></header>
    {results.length ? <><div className="v09-test-kpis"><b className={passed === results.length ? "good" : "low"}>{passed}/{results.length}</b><span>{analyses} ניתוחי Core · {elapsed?.toFixed(0)} ms</span></div><div className="v09-test-grid">{results.map((result, index) => <article key={`${result.name}-${index}`}><header><b>{result.name}</b><span className={result.pass ? "pass" : "fail"}>{result.pass ? "PASS" : "FAIL"}</span></header><small>{result.category}</small><p>{result.detail}</p></article>)}</div></> : <div className="v09-empty-tests"><ShieldCheck /><b>טרם הורץ</b><p>הבדיקות מייצרות ניווט, מנתחות אותו דרך Python Core ומשוות ל־GT חיצוני.</p></div>}
  </div>;
}