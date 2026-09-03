"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Check, Download, FileDown, Filter, LoaderCircle, MessageSquareText, Save, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getServerScenario } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { EventMiniMap, LiveMap, MapLoadingOverlay, ScoreRing, TimelineChart, type GroupKey, type ScoreLayer } from "./visuals";
import { WolfLogo } from "./wolf-logo";

type InvestigationEvent = {
  id: string;
  time: string;
  start: string;
  end: string;
  family: GroupKey;
  group: string;
  score: number;
  sync: number;
  route: number;
  quality: string;
  reason: string;
  successes: string[];
  failures: string[];
  members: { id: number; total: number; sync: number; route: number; cause: string }[];
};

const quality = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";

function buildEvents(server: string): InvestigationEvent[] {
  const scenario = getServerScenario(server);
  const makeMembers = (family: GroupKey, scoreShift = 0) => scenario.groups[family].members.map((member, index) => ({
    id: member.id,
    total: Math.max(0, Math.min(100, member.score + scoreShift - index)),
    sync: Math.max(0, Math.min(100, member.sync + scoreShift - index)),
    route: Math.max(0, Math.min(100, member.route + scoreShift)),
    cause: family === "so" && index === 1 ? "תזמון פנייה" : family === "si" ? "הפרש זווית" : "פאזה ורבע",
  }));
  const si = scenario.groups.si; const so = scenario.groups.so;
  return [
    { id: `${server}-evt-si-01`, time: "18:12–18:47", start: "18:12", end: "18:47", family: "si", group: si.id, score: si.total, sync: si.sync, route: si.route, quality: quality(si.total), reason: si.reason, successes: ["זמן מחזור יציב בין כל הרכבים", "מרכזי הטבעות נשמרו בתחום ההתאמה"], failures: si.total < 80 ? ["סטיית זווית בין טבעת ביניים לחיצונית"] : [], members: makeMembers("si") },
    { id: `${server}-evt-so-02`, time: "18:21–18:39", start: "18:21", end: "18:39", family: "so", group: so.id, score: so.total, sync: so.sync, route: so.route, quality: quality(so.total), reason: so.reason, successes: ["מרחק מהנתיב והכיוון המשיק נשמרו", "היררכיית ח׳ זוהתה ברציפות"], failures: so.total < 80 ? ["כניסה לפנייה לא תוזמנה עם שאר הקבוצה", "פער פאזה מקומי ברכב בעל הציון הנמוך"] : [], members: makeMembers("so") },
    { id: `${server}-evt-so-01`, time: "17:46–18:10", start: "17:46", end: "18:10", family: "so", group: so.id, score: Math.max(41, so.total - 15), sync: Math.max(32, so.sync - 18), route: Math.max(67, so.route - 7), quality: "נמוך", reason: "רבע לא מתאים ואיחור מתמשך בפניות", successes: ["הנתיב האפקטיבי נשמר למרות הבליטה הקבועה"], failures: ["שני רצפי פנייה לא היו מסונכרנים", "סטיית פאזה מעל 25% מהמחזור"], members: makeMembers("so", -11) },
    { id: `${server}-evt-si-02`, time: "17:18–17:42", start: "17:18", end: "17:42", family: "si", group: si.id, score: Math.max(75, si.total - 4), sync: Math.max(77, si.sync - 5), route: Math.max(71, si.route - 2), quality: "טוב", reason: "ביצוע יציב; סטייה קלה מהמשיק", successes: ["שלושת הפרשי הזווית נשמרו", "כיוון הסיבוב אחיד"], failures: ["סטייה קלה בכיוון המשיק של רכב אחד"], members: makeMembers("si", -3) },
  ];
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export function InvestigationView({ server, onServerChange }: { server: string; onServerChange: (server: string) => void }) {
  const { state, save } = useWorkspace();
  const [from, setFrom] = useState("2026-09-02T17:00");
  const [to, setTo] = useState("2026-09-02T19:00");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedId, setSelectedId] = useState(`${server}-evt-so-02`);
  const [familyFilter, setFamilyFilter] = useState<"all" | GroupKey>("all");
  const [cursor, setCursor] = useState(84);
  const [layers] = useState<ScoreLayer[]>(["total", "sync", "route"]);
  const allEvents = useMemo(() => buildEvents(server), [server]);
  const selected = allEvents.find((event) => event.id === selectedId) ?? allEvents[1] ?? allEvents[0];
  const [draftEdits, setDraftEdits] = useState(state.investigationEdits);
  const currentEdit = draftEdits[selected.id] ?? state.investigationEdits[selected.id] ?? { note: "", templateId: state.templates.find((item) => item.family.toLowerCase() === selected.family)?.id ?? "" };
  const events = allEvents.filter((event) => familyFilter === "all" || event.family === familyFilter);
  const grouped = (["si", "so"] as GroupKey[]).map((family) => ({ family, events: allEvents.filter((event) => event.family === family) }));

  const loadRange = () => {
    if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום"); return; }
    setLoading(true); setProgress(4);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + Math.max(3, Math.round((100 - value) / 7)));
      if (next >= 100) { window.clearInterval(timer); window.setTimeout(() => { setLoading(false); toast.success("הטווח נטען וחושב מחדש"); }, 300); }
      return next;
    }), 180);
  };
  const saveEdit = () => save({ ...state, investigationEdits: { ...state.investigationEdits, [selected.id]: currentEdit } }, "investigation", "event-edit", `${selected.group} · ${selected.time}`);
  const familyColor = selected.family === "si" ? "#22cbb8" : "#ff9f43";

  return (
    <div className="investigation-workspace">
      <section className="investigation-filter glass-panel">
        <div><p className="eyebrow">תחקור לאחור</p><h2>שרת וטווח זמן</h2><p>נתונים חסרים נשלפים מחדש מ־Influx ומוצגים בגרסה המחושבת האחרונה.</p></div>
        <div className="investigation-controls">
          <label><span>מספר שרת</span><Select value={server} onValueChange={(value) => { onServerChange(value); setSelectedId(`${value}-evt-so-02`); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.arena}</SelectItem>)}</SelectContent></Select></label>
          <label><span>מתאריך</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>עד תאריך</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <Button onClick={loadRange} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "טוען" : "טען טווח"}</Button>
        </div>
        {loading && <div className="range-progress"><Progress value={progress} /><span>{progress}% · {progress < 35 ? "שולף נתונים" : progress < 72 ? "מזהה נתיבים וקבוצות" : "מחשב ציונים ואירועים"}</span></div>}
      </section>

      <section className="investigation-timeline glass-panel">
        <div className="section-toolbar"><div><p className="eyebrow">ציר זמן</p><h2>{events.length} אירועים בטווח</h2></div><div className="toolbar-actions"><div className="segmented-control"><button type="button" className={familyFilter === "all" ? "active" : ""} onClick={() => setFamilyFilter("all")}>הכול</button><button type="button" className={familyFilter === "si" ? "active" : ""} onClick={() => setFamilyFilter("si")}>SI</button><button type="button" className={familyFilter === "so" ? "active" : ""} onClick={() => setFamilyFilter("so")}>SO</button></div><Button variant="outline" size="sm" onClick={() => downloadJson(`bluewolf-server-${server}.json`, { server, from, to, events: allEvents })}><Download />נתונים</Button><Button size="sm" onClick={() => { toast.info("מכין דוח זאב כחול; בחלון ההדפסה בחר שמירה כ־PDF"); window.setTimeout(() => window.print(), 350); }}><FileDown />דוח PDF</Button></div></div>
        <div className="timeline-legend"><span><i style={{ background: "#22cbb8" }} />SI</span><span><i style={{ background: "#ff9f43" }} />SO</span><span><i className="line-solid" />סנכרון</span><span><i className="line-dotted" />כולל</span><span><i className="line-dashed" />נתיב</span><span><i className="event-border" />גבול אירוע</span></div>
        <TimelineChart serverId={server} selected={selected.family} layers={layers} cursor={cursor} onCursor={setCursor} fromLabel={from.replace("T", " ")} toLabel={to.replace("T", " ")} />
        <div className="timeline-footer"><span><CalendarRange />{from.replace("T", " ")} – {to.replace("T", " ")}</span><span><SlidersHorizontal />כל הקבוצות וכל שכבות הציון</span></div>
      </section>

      <div className="investigation-main">
        <section className="event-list glass-panel">
          <div className="list-title"><div><p className="eyebrow">אירועים</p><h2>לפי זמן</h2></div><Filter /></div>
          <div className="event-list-scroll">{events.map((event) => { const color = event.score >= 80 ? "#22cbb8" : event.score < 50 ? "#ef6b73" : "#f6bf4f"; return <button type="button" className={`event-row ${selected.id === event.id ? "active" : ""}`} key={event.id} onClick={() => setSelectedId(event.id)}><EventMiniMap family={event.family} color={color} /><div><span>{event.time}</span><strong>{event.group} · {event.quality}</strong><p>{event.reason}</p></div><ScoreRing value={event.score} color={color} size="small" /></button>; })}</div>
        </section>
        <section className="event-detail glass-panel">
          <div className="section-toolbar"><div><p className="eyebrow">אירוע נבחר · {selected.time}</p><h2>{selected.group} · {selected.quality}</h2></div><div className="event-score-summary"><span>סנכרון <b>{selected.sync}</b></span><span>נתיב <b>{selected.route}</b></span><ScoreRing value={selected.score} color={familyColor} /></div></div>
          <div className="investigation-map-wrap"><LiveMap serverId={server} tick={cursor} selectedGroup={selected.family} selectedVehicle={null} showTrace showRoutes showRelations showGrid vehicleTypes={state.vehicleTypes} animate={false} onSelectGroup={() => undefined} onSelectVehicle={(id) => toast.info(`רכב ${id}: לחץ על השורה לקבלת הציון המלא`)} />{loading && <MapLoadingOverlay progress={progress} label="מחשב מחדש את האירוע" />}</div>
          <div className="event-root-causes"><article><strong>גורמי הצלחה</strong>{selected.successes.map((item) => <p key={item}><Check />{item}</p>)}</article><article><strong>גורמי כשל / שיפור</strong>{selected.failures.length ? selected.failures.map((item) => <p key={item}><span>!</span>{item}</p>) : <p><Check />לא זוהה גורם כשל משמעותי</p>}</article></div>
          <div className="event-score-table"><div className="table-head"><span>רכב</span><span>כולל</span><span>סנכרון</span><span>נתיב</span><span>גורם מוביל</span></div>{selected.members.map((member) => <div className="table-row" key={member.id}><strong>{member.id}</strong><span>{member.total}</span><span>{member.sync}</span><span>{member.route}</span><span>{member.cause}</span></div>)}</div>
          <div className="event-editor"><label><span>תבנית שחלה בפועל</span><Select value={currentEdit.templateId} onValueChange={(templateId) => setDraftEdits({ ...draftEdits, [selected.id]: { ...currentEdit, templateId } })}><SelectTrigger><SelectValue placeholder="בחר תבנית" /></SelectTrigger><SelectContent>{state.templates.filter((item) => item.family.toLowerCase() === selected.family).map((item) => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label className="note-field"><span><MessageSquareText />הערת מפעיל</span><Textarea value={currentEdit.note} onChange={(event) => setDraftEdits({ ...draftEdits, [selected.id]: { ...currentEdit, note: event.target.value } })} placeholder="הערה שתופיע בתחקור ובדוח" /></label><Button onClick={saveEdit}><Save />שמור עריכה</Button></div>
        </section>
      </div>

      <section className="pdf-report" dir="rtl">
        <header className="pdf-brand-header"><div className="pdf-logo"><WolfLogo /></div><div><p>BLUE WOLF · SYSTEM REPORT</p><h1>דוח ביצוע קבוצות ונתיבים</h1><span>שרת {server} · {from.replace("T", " ")} – {to.replace("T", " ")}</span></div><div className="pdf-classification">דוח מבצעי</div></header>
        <section className="pdf-summary"><h2>סיכום מנהלים</h2><p>הדוח כולל את כל הקבוצות והאירועים התקפים בטווח. מקטעי מעבר הושמטו. הכיסוי מוצג בנפרד ואינו משנה את אמינות הרכבים.</p><div className="pdf-summary-grid">{grouped.map(({ family, events: groupEvents }) => { const avg = Math.round(groupEvents.reduce((sum, event) => sum + event.score, 0) / groupEvents.length); return <article key={family}><span>{family.toUpperCase()}</span><strong>{groupEvents[0]?.group}</strong><b>{avg}</b><small>ציון כולל משוקלל בזמן · {groupEvents.length} מקטעים</small></article>; })}</div></section>
        {grouped.map(({ family, events: groupEvents }) => <section className="pdf-group-chapter" key={family}><div className="pdf-chapter-title"><span>{family.toUpperCase()}</span><div><h2>{groupEvents[0]?.group}</h2><p>{family === "si" ? "טבעות משותפות · חוקיות זוויות" : "מבנה ח׳ · חוקיות רבעים ופניות"}</p></div></div>{groupEvents.map((event) => <article className="pdf-event" key={event.id}><header><div><span>מקטע {event.start}–{event.end}</span><h3>{event.quality} · {event.reason}</h3></div><div className="pdf-score-pills"><b>כולל {event.score}</b><span>סנכרון {event.sync}</span><span>נתיב {event.route}</span></div></header><div className="pdf-event-grid"><div><h4>ציוני רכבים</h4><table><thead><tr><th>רכב</th><th>כולל</th><th>סנכרון</th><th>נתיב</th><th>גורם מוביל</th></tr></thead><tbody>{event.members.map((member) => <tr key={member.id}><td>{member.id}</td><td>{member.total}</td><td>{member.sync}</td><td>{member.route}</td><td>{member.cause}</td></tr>)}</tbody></table></div><div className="pdf-causes"><h4>Root causes</h4>{event.successes.map((item) => <p className="success" key={item}>✓ {item}</p>)}{event.failures.map((item) => <p className="failure" key={item}>! {item}</p>)}</div></div></article>)}</section>)}
        <section className="pdf-alerts"><h2>התראות בטווח</h2>{allEvents.filter((event) => event.failures.length).map((event) => <p key={event.id}><strong>{event.time} · {event.group}</strong><span>{event.failures.join(" · ")}</span></p>)}</section>
        <footer className="pdf-footer"><WolfLogo /><span>זאב כחול · הופק אוטומטית לפי גרסת הקונפיגורציה הפעילה</span><b>{new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</b></footer>
      </section>
    </div>
  );
}
