"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Download, FileDown, Filter, LoaderCircle, Save, Search, TrendingDown, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getServerScenario } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { EventMiniMap, EventOverviewMap, LiveMap, MapLoadingOverlay, ScoreRing, TimelineChart, groupLineColor, type GroupKey, type ScoreLayer } from "./visuals";
import { WolfLogo } from "./wolf-logo";

type RootCause = { label: string; sharePct: number; impactPoints: number; contribution: number };
type InvestigationEvent = { id: string; start: string; end: string; durationMin: number; family: GroupKey; group: string; members: number[]; templateId: string; score: number; sync: number; route: number; rootCauses: RootCause[] };

const quality = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";

function buildEvents(server: string): InvestigationEvent[] {
  const scenario = getServerScenario(server); const si = scenario.groups.si; const so = scenario.groups.so;
  return [
    { id: `${server}-group-event-01`, start: "17:08", end: "17:42", durationMin: 34, family: "si", group: si.id, members: si.members.map((m) => m.id), templateId: si.templateId, score: Math.max(72, si.total - 4), sync: Math.max(70, si.sync - 5), route: Math.max(70, si.route - 2), rootCauses: [{ label: "סטיית זווית בין זוג רכבים", sharePct: 18, impactPoints: 7.4, contribution: 1.3 }, { label: "סטייה קלה מהמשיק", sharePct: 9, impactPoints: 3.2, contribution: .3 }] },
    { id: `${server}-group-event-02`, start: "17:48", end: "18:39", durationMin: 51, family: "so", group: so.id, members: so.members.map((m) => m.id), templateId: so.templateId, score: so.total, sync: so.sync, route: so.route, rootCauses: [{ label: "איחור בתזמון פנייה", sharePct: 31, impactPoints: 17.6, contribution: 5.5 }, { label: "פער פאזה באזור פנייה", sharePct: 22, impactPoints: 10.4, contribution: 2.3 }, { label: "סטיית מרחק מהנתיב", sharePct: 8, impactPoints: 4.1, contribution: .3 }] },
    { id: `${server}-group-event-03`, start: "18:44", end: "19:26", durationMin: 42, family: "si", group: si.id, members: si.members.map((m) => m.id), templateId: si.templateId, score: Math.min(95, si.total + 5), sync: Math.min(97, si.sync + 4), route: Math.min(94, si.route + 6), rootCauses: [{ label: "סטיית משיק קלה", sharePct: 6, impactPoints: 2.1, contribution: .1 }] },
  ];
}

function downloadJson(filename: string, payload: unknown) { const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

export function InvestigationView({ server, onServerChange }: { server: string; onServerChange: (server: string) => void }) {
  const { state, save } = useWorkspace();
  const [arena, setArena] = useState(state.arenas[0] ?? "זירה א׳");
  const [from, setFrom] = useState("2026-09-02T17:00");
  const [to, setTo] = useState("2026-09-02T19:30");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [familyFilter, setFamilyFilter] = useState<"all" | GroupKey>("all");
  const [cursor, setCursor] = useState(72);
  const layers: ScoreLayer[] = ["total", "sync", "route"];
  const allEvents = useMemo(() => buildEvents(server), [server]);
  const [selectedId, setSelectedId] = useState(`${server}-group-event-02`);
  const selected = allEvents.find((event) => event.id === selectedId) ?? allEvents[0];
  const events = allEvents.filter((event) => familyFilter === "all" || event.family === familyFilter);
  const totalMinutes = allEvents.reduce((sum, event) => sum + event.durationMin, 0);
  const weightedScore = Math.round(allEvents.reduce((sum, event) => sum + event.score * event.durationMin, 0) / totalMinutes);
  const best = [...allEvents].sort((a, b) => b.score - a.score)[0];
  const [draftTemplateId, setDraftTemplateId] = useState(selected.templateId);
  const [draftNote, setDraftNote] = useState("");

  useEffect(() => {
    const saved = state.investigationEdits[selected.id];
    setDraftTemplateId(saved?.templateId || selected.templateId);
    setDraftNote(saved?.note || "");
  }, [selected.id, selected.templateId, state.investigationEdits]);

  const loadRange = () => {
    if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום"); return; }
    setLoading(true); setProgress(5);
    const timer = window.setInterval(() => setProgress((value) => { const next = Math.min(100, value + 13); if (next >= 100) { window.clearInterval(timer); window.setTimeout(() => { setLoading(false); toast.success("הטווח נטען וחולק לאירועי קבוצתיות"); }, 180); } return next; }), 110);
  };
  const saveEdit = async () => {
    const nextEdit = { note: draftNote.trim(), templateId: draftTemplateId };
    await save({ ...state, investigationEdits: { ...state.investigationEdits, [selected.id]: nextEdit } }, "investigation", "event-edit", selected.id);
  };

  return <div className="investigation-workspace v04-investigation">
    <section className="investigation-filter glass-panel"><div><p className="eyebrow">תחקור לאחור</p><h2>טווח, שרת וזירה</h2><p>אירוע מוגדר כרצף שבו קבוצה שומרת על הקבוצתיות שלה. התראות אינן אירועים.</p></div><div className="investigation-controls"><label><span>שרת</span><Select value={server} onValueChange={(value) => { onServerChange(value); setSelectedId(`${value}-group-event-02`); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label><span>זירה</span><Select value={arena} onValueChange={setArena}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>מתאריך</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>עד תאריך</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><Button onClick={loadRange} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "טוען" : "טען"}</Button></div>{loading && <div className="range-progress"><Progress value={progress} /><span>{progress}% · {progress < 45 ? "מזהה קבוצתיות" : "מחשב ציונים ו-root causes"}</span></div>}</section>

    <section className="v04-investigation-summary"><article className="glass-panel"><span>אירועי קבוצתיות</span><strong>{allEvents.length}</strong><small>{totalMinutes} דקות בקבוצות</small></article><article className="glass-panel"><span>ציון משוקלל בזמן</span><strong>{weightedScore}</strong><small>לפי משך כל אירוע</small></article><article className="glass-panel"><span>האירוע המוביל</span><strong>{best.group}</strong><small>{best.score} נק׳ · {best.durationMin} דק׳</small></article><article className="glass-panel"><span>root cause מוביל</span><strong>{selected.rootCauses[0]?.sharePct ?? 0}%</strong><small>{selected.rootCauses[0]?.label ?? "ללא"}</small></article></section>

    <section className="v04-summary-map glass-panel"><div className="section-toolbar"><div><p className="eyebrow">מפה מסכמת</p><h2>כל האירועים בטווח · {arena}</h2></div><div className="toolbar-actions"><Button variant="outline" size="sm" onClick={() => downloadJson(`bluewolf-${server}-${arena}.json`, { server, arena, from, to, events: allEvents })}><Download />JSON</Button><Button size="sm" onClick={() => { toast.info("הדוח כולל סיכום, מפה, אירועים ו-root causes בלבד"); window.setTimeout(() => window.print(), 250); }}><FileDown />PDF</Button></div></div><EventOverviewMap eventLabels={allEvents.map((_, index) => `E${index + 1}`)} /></section>

    <section className="investigation-timeline glass-panel"><div className="section-toolbar"><div><p className="eyebrow">ציר זמן</p><h2>ציונים בתוך אירועי הקבוצתיות</h2></div><div className="segmented-control"><button type="button" className={familyFilter === "all" ? "active" : ""} onClick={() => setFamilyFilter("all")}>הכול</button><button type="button" className={familyFilter === "si" ? "active" : ""} onClick={() => setFamilyFilter("si")}>SI</button><button type="button" className={familyFilter === "so" ? "active" : ""} onClick={() => setFamilyFilter("so")}>SO</button></div></div><TimelineChart serverId={server} selected={selected.family} layers={layers} cursor={cursor} onCursor={setCursor} fromLabel={from.replace("T", " ")} toLabel={to.replace("T", " ")} /><div className="timeline-footer"><span><CalendarRange />גבולות E1/E2/E3 הם גבולות קבוצתיות</span><span>אין רשימת התראות בדוח</span></div></section>

    <div className="investigation-main v04-investigation-main"><section className="event-list glass-panel"><div className="list-title"><div><p className="eyebrow">אירועים</p><h2>{events.length} רצפי קבוצתיות</h2></div><Filter /></div><div className="event-list-scroll">{events.map((event) => { const color = groupLineColor[event.family]; return <button type="button" className={`event-row ${selected.id === event.id ? "active" : ""}`} key={event.id} onClick={() => setSelectedId(event.id)}><EventMiniMap family={event.family} color={color} /><div><span>E{allEvents.indexOf(event) + 1} · {event.start}–{event.end}</span><strong>{event.group} · {quality(event.score)}</strong><p>{event.durationMin} דק׳ · {event.members.length} רכבים · {event.rootCauses.length} גורמי שורש</p></div><ScoreRing value={event.score} color={color} size="small" /></button>; })}</div></section>
      <section className="event-detail glass-panel"><div className="section-toolbar"><div><p className="eyebrow">אירוע נבחר · {selected.start}–{selected.end}</p><h2>{selected.group} · {quality(selected.score)}</h2><p><UsersRound /> {selected.members.join(" · ")}</p></div><div className="event-score-summary"><span>סנכרון <b>{selected.sync}</b></span><span>נתיב <b>{selected.route}</b></span><ScoreRing value={selected.score} color={groupLineColor[selected.family]} /></div></div><div className="investigation-map-wrap"><LiveMap serverId={server} tick={cursor} selectedGroup={selected.family} selectedVehicle={null} showTrace={false} showRoutes showRelations showGrid vehicleTypes={state.vehicleTypes} animate={false} onSelectGroup={() => undefined} onSelectVehicle={() => undefined} />{loading && <MapLoadingOverlay progress={progress} label="מחשב את האירוע" />}</div>
        <div className="v04-root-causes"><div className="panel-title"><div><p className="eyebrow">Root causes</p><h3>הסיבות שהורידו את הציון</h3></div><Badge variant="outline">מדורג לפי תרומה</Badge></div>{[...selected.rootCauses].sort((a, b) => b.contribution - a.contribution).map((cause, index) => <article key={cause.label}><span className="v04-cause-rank">#{index + 1}</span><div><strong>{cause.label}</strong><small>{cause.sharePct}% מזמן האירוע</small></div><span><TrendingDown />השפעה בעת הופעה <b>−{cause.impactPoints}</b></span><span>תרומה כוללת <b>−{cause.contribution}</b></span></article>)}</div>
        <div className="event-editor v04-event-editor"><div><p className="eyebrow">תיקון תחקור</p><h3>תבנית והערת מפתח</h3></div><label><span>תבנית לחישוב האירוע</span><Select value={draftTemplateId} onValueChange={setDraftTemplateId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.templates.filter((item) => item.family.toLowerCase() === selected.family).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><Textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="הערת תחקור קצרה" /><Button onClick={saveEdit}><Save />שמור תיקון</Button></div>
      </section></div>

    <section className="v04-print-report"><header><WolfLogo /><div><h1>זאב כחול · דוח תחקור</h1><p>{server} · {arena} · {from.replace("T", " ")}–{to.replace("T", " ")}</p></div></header><div className="v04-print-kpis"><span>אירועים<b>{allEvents.length}</b></span><span>זמן בקבוצות<b>{totalMinutes} דק׳</b></span><span>ציון משוקלל<b>{weightedScore}</b></span></div><EventOverviewMap eventLabels={allEvents.map((_, index) => `E${index + 1}`)} />{allEvents.map((event, index) => <article className="v04-print-event" key={event.id}><header><h2>E{index + 1} · {event.group}</h2><span>{event.start}–{event.end} · {event.durationMin} דק׳</span></header><div className="v04-print-scores"><b>כולל {event.score}</b><span>סנכרון {event.sync}</span><span>נתיב {event.route}</span></div><table><thead><tr><th>Root cause</th><th>% זמן</th><th>השפעה</th><th>תרומה כוללת</th></tr></thead><tbody>{event.rootCauses.map((cause) => <tr key={cause.label}><td>{cause.label}</td><td>{cause.sharePct}%</td><td>−{cause.impactPoints}</td><td>−{cause.contribution}</td></tr>)}</tbody></table></article>)}</section>
  </div>;
}