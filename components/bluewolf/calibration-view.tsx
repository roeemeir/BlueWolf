"use client";

import { useEffect, useMemo, useState } from "react";
import { Beaker, Check, Grid3X3, LoaderCircle, Pause, Play, Save, Search, SlidersHorizontal, Trophy } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createId, getServerScenario, type Family, type GtSegment } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { GtPlayback } from "./visuals";

type CalibrationTab = "gt" | "sweep" | "heatmap";

type SweepResult = {
  id: string;
  label: string;
  score: number;
  details: string;
};

function SectionHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <header className="developer-section-header glass-panel"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children}</header>;
}

function GtWorkspace() {
  const { state, save } = useWorkspace();
  const [serverId, setServerId] = useState(state.servers.find((item) => item.enabled)?.id ?? "1");
  const [arena, setArena] = useState(state.arenas[0] ?? "זירה א׳");
  const [family, setFamily] = useState<Family>("SO");
  const [from, setFrom] = useState("2026-09-03T07:30");
  const [to, setTo] = useState("2026-09-03T08:30");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(36);
  const [clipStart, setClipStart] = useState(8);
  const [clipEnd, setClipEnd] = useState(92);
  const [syncJudge, setSyncJudge] = useState(75);
  const [routeJudge, setRouteJudge] = useState(80);
  const [routeCorrection, setRouteCorrection] = useState("auto");

  const scenario = getServerScenario(serverId);
  const group = scenario.groups[family.toLowerCase() as "si" | "so"];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPlayhead((value) => value >= clipEnd ? clipStart : value + 1), 110);
    return () => window.clearInterval(timer);
  }, [playing, clipStart, clipEnd]);

  const load = () => {
    if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות לפני זמן הסיום"); return; }
    setLoading(true);
    setProgress(5);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 14);
      if (next >= 100) {
        window.clearInterval(timer);
        setLoading(false);
        setLoaded(true);
        setPlayhead(Math.max(clipStart, Math.min(clipEnd, playhead)));
      }
      return next;
    }), 90);
  };

  const saveGt = async () => {
    if (!loaded) return;
    const base = {
      family,
      serverId,
      groupId: group.id,
      start: from,
      end: to,
      vehicleCount: group.members.length,
      routeType: routeCorrection === "auto" ? (family === "SI" ? "compact" : "hippodrome") : routeCorrection,
    };
    const syncQuality: GtSegment["quality"] = syncJudge >= 80 ? "good" : syncJudge < 50 ? "low" : "medium";
    const routeQuality: GtSegment["quality"] = routeJudge >= 80 ? "good" : routeJudge < 50 ? "low" : "medium";
    const additions: GtSegment[] = [
      { ...base, id: createId("gt-sync"), layer: "sync", quality: syncQuality, label: `${group.id} · GT Sync`, score: syncJudge },
      { ...base, id: createId("gt-route"), layer: "route", quality: routeQuality, label: `${group.id} · GT Route`, score: routeJudge },
    ];
    await save({ ...state, gtSegments: [...state.gtSegments, ...additions] }, "gt", "approve-scenario", `${group.id} · clip ${clipStart}-${clipEnd}`);
    toast.success("תרחיש ה־GT נשמר עם ציוני Sync/Route נפרדים");
  };

  return <div className="calibration-stack">
    <SectionHeader eyebrow="Ground Truth" title="Playback, Clip ותיוג" description="ה־GT הוא Scenario היררכי: טווח זמן, קבוצות, רכבים, גיאומטריה, כללי סנכרון ופרופיל ציונים." />
    <section className="v04-gt-source glass-panel">
      <div className="gt-source-grid calibration-source-grid">
        <label><span>שרת</span><Select value={serverId} onValueChange={setServerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
        <label><span>זירה</span><Select value={arena} onValueChange={setArena}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label>
        <label><span>משפחה</span><Select value={family} onValueChange={(value) => setFamily(value as Family)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label>
        <label><span>התחלה</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>סיום</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <Button onClick={load} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "טוען" : "שלוף טווח"}</Button>
      </div>
      {loading && <Progress value={progress} />}
      {loaded && <div className="v04-gt-review calibration-review">
        <div className="v04-gt-player">
          <GtPlayback family={family} progress={playhead / 100} vehicleTypes={state.vehicleTypes} />
          <div className="v04-player-controls"><Button variant="outline" size="icon" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</Button><Slider value={[playhead]} min={clipStart} max={clipEnd} step={1} onValueChange={(values) => setPlayhead(values[0])} /><b>{playhead}%</b></div>
          <div className="clip-controls"><label><span>Start</span><Slider value={[clipStart]} min={0} max={Math.max(0, clipEnd - 1)} step={1} onValueChange={(values) => { setClipStart(values[0]); setPlayhead((p) => Math.max(p, values[0])); }} /><b>{clipStart}%</b></label><label><span>End</span><Slider value={[clipEnd]} min={Math.min(99, clipStart + 1)} max={100} step={1} onValueChange={(values) => { setClipEnd(values[0]); setPlayhead((p) => Math.min(p, values[0])); }} /><b>{clipEnd}%</b></label></div>
        </div>
        <aside className="calibration-judgement">
          <p className="eyebrow">שיפוט מפתח</p><h3>ציוני אמת נפרדים</h3>
          <label><span>Sync</span><Slider value={[syncJudge]} min={0} max={100} step={5} onValueChange={(values) => setSyncJudge(values[0])} /><strong>{syncJudge}</strong></label>
          <label><span>Route</span><Slider value={[routeJudge]} min={0} max={100} step={5} onValueChange={(values) => setRouteJudge(values[0])} /><strong>{routeJudge}</strong></label>
          <label><span>תיקון סיווג נתיב</span><Select value={routeCorrection} onValueChange={setRouteCorrection}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">ללא תיקון · Auto</SelectItem><SelectItem value="compact">Compact / SI</SelectItem><SelectItem value="hippodrome">Hippodrome</SelectItem><SelectItem value="double">Double Hippodrome</SelectItem><SelectItem value="figure8">Figure‑8 · Single-SO semantics</SelectItem></SelectContent></Select></label>
          <Button onClick={saveGt}><Check />אשר ושמור GT</Button>
        </aside>
      </div>}
    </section>
    <section className="gt-bank glass-panel"><div className="panel-title"><div><p className="eyebrow">GT Bank</p><h3>{state.gtSegments.length} תיוגים</h3></div><Badge variant="outline">Scenario → Groups → Scores</Badge></div><div className="v04-gt-table">{state.gtSegments.length === 0 ? <div className="empty-state">אין עדיין תרחישי GT שמורים.</div> : state.gtSegments.slice().reverse().map((item) => <div key={item.id}><strong>{item.groupId}</strong><span>{item.family} · {item.routeType}</span><span>{item.start.slice(11)}–{item.end.slice(11)}</span><span>{item.layer === "sync" ? "Sync" : "Route"}</span><Badge>{item.quality}</Badge><b>{item.score}</b></div>)}</div></section>
  </div>;
}

function SweepWorkspace({ mode }: { mode: "ranking" | "heatmap" }) {
  const { state } = useWorkspace();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SweepResult[]>([]);
  const scenarioCount = useMemo(() => new Set(state.gtSegments.map((item) => `${item.serverId}:${item.groupId}:${item.start}:${item.end}`)).size, [state.gtSegments]);

  const run = () => {
    if (scenarioCount === 0) { toast.warning("נדרש לפחות GT Scenario אחד לפני Sweep"); return; }
    // UI contract only: no synthetic ranking. A real ranking must come from Core Replay/Sweep.
    setRunning(true); setProgress(8); setResults([]);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 12);
      if (next >= 100) {
        window.clearInterval(timer); setRunning(false);
        toast.info("ממשק הכיול מוכן; תוצאות יופיעו רק מ־Core Replay/Sweep אמיתי");
      }
      return next;
    }), 110);
  };

  return <div className="calibration-stack">
    <SectionHeader eyebrow="Calibration" title={mode === "ranking" ? "Parameter Sweep ודירוג" : "Heatmap פרמטרים"} description="אותם תרחישי GT מורצים מול סטים של פרמטרים. אין יצירת Best/Heatmap סינתטיים בצד ה־UI."><Button onClick={run} disabled={running || scenarioCount === 0}>{running ? <LoaderCircle className="spin" /> : <Beaker />}{running ? "מריץ" : "הרץ Sweep"}</Button></SectionHeader>
    <section className="calibration-summary-grid"><article className="glass-panel"><span>GT Scenarios</span><strong>{scenarioCount}</strong><small>{state.gtSegments.length} שכבות ציונים</small></article><article className="glass-panel"><span>Config Version</span><strong>Active</strong><small>נדרש provenance לכל תוצאה</small></article><article className="glass-panel"><span>Algorithm</span><strong>Core</strong><small>Replay בלבד, לא חישוב UI</small></article></section>
    {running && <section className="glass-panel calibration-progress"><Progress value={progress} /><span>{progress}% · Replay → Compare GT → Rank</span></section>}
    {mode === "ranking" ? <section className="glass-panel calibration-results"><div className="panel-title"><div><p className="eyebrow">Ranking</p><h3>תוצאות Sweep</h3></div><Trophy /></div>{results.length === 0 ? <div className="empty-state"><Trophy /><strong>אין עדיין דירוג Core</strong><span>ה־UI אינו ממציא תוצאה. כאשר Replay/Sweep יחזיר candidates, הם יוצגו כאן לפי metric המאושר.</span></div> : results.map((result) => <article key={result.id}><b>{result.score}</b><div><strong>{result.label}</strong><small>{result.details}</small></div></article>)}</section> : <section className="glass-panel calibration-heatmap"><div className="panel-title"><div><p className="eyebrow">Heatmap</p><h3>מפת איכות פרמטרים</h3></div><Grid3X3 /></div><div className="empty-state"><SlidersHorizontal /><strong>Heatmap ממתין לתוצאות Sweep</strong><span>צירים, cells ו־Best marker ייבנו רק מתוצאות Core אמיתיות.</span></div></section>}
  </div>;
}

export function CalibrationView() {
  const [tab, setTab] = useState<CalibrationTab>("gt");
  return <div className="calibration-workspace v04-calibration"><Tabs value={tab} onValueChange={(value) => setTab(value as CalibrationTab)} dir="rtl"><div className="calibration-nav glass-panel"><div><p className="eyebrow">Developer Ground Truth & Calibration</p><h2>כיול ואימות</h2></div><TabsList><TabsTrigger value="gt"><Save />GT</TabsTrigger><TabsTrigger value="sweep"><Beaker />Sweep & Rank</TabsTrigger><TabsTrigger value="heatmap"><Grid3X3 />Heatmap</TabsTrigger></TabsList></div><TabsContent value="gt"><GtWorkspace /></TabsContent><TabsContent value="sweep"><SweepWorkspace mode="ranking" /></TabsContent><TabsContent value="heatmap"><SweepWorkspace mode="heatmap" /></TabsContent></Tabs></div>;
}
