"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Download, FileDown, Filter, LoaderCircle, MessageSquareText, Save, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "./app-context";
import { EventMiniMap, LiveMap, MapLoadingOverlay, ScoreRing, TimelineChart, type GroupKey, type ScoreLayer } from "./visuals";

type InvestigationEvent = {
  id: string;
  time: string;
  family: GroupKey;
  group: string;
  score: number;
  sync: number;
  route: number;
  quality: string;
  reason: string;
  members: number[];
};

const EVENT_DATA: InvestigationEvent[] = [
  { id: "evt-si-01", time: "18:12–18:47", family: "si", group: "SI-01", score: 87, sync: 90, route: 79, quality: "טוב", reason: "הפרשי הזווית נשמרו לאורך האירוע", members: [101, 102, 103] },
  { id: "evt-so-02", time: "18:21–18:39", family: "so", group: "SO-02", score: 62, sync: 56, route: 82, quality: "בינוני", reason: "תזמון פנייה מאוחר ברכב 212", members: [211, 212, 213] },
  { id: "evt-so-01", time: "17:46–18:10", family: "so", group: "SO-01", score: 48, sync: 39, route: 75, quality: "נמוך", reason: "סטיית פאזה ורבע לא מתאים", members: [205, 206, 207] },
  { id: "evt-si-02", time: "17:18–17:42", family: "si", group: "SI-02", score: 81, sync: 83, route: 76, quality: "טוב", reason: "ביצוע יציב; סטייה קלה מהמשיק", members: [111, 112] },
];

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function InvestigationView({ server, onServerChange }: { server: string; onServerChange: (server: string) => void }) {
  const { state, save } = useWorkspace();
  const [from, setFrom] = useState("2026-09-02T17:00");
  const [to, setTo] = useState("2026-09-02T19:00");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(true);
  const [selectedId, setSelectedId] = useState("evt-so-02");
  const [familyFilter, setFamilyFilter] = useState<"all" | GroupKey>("all");
  const [cursor, setCursor] = useState(42);
  const [layers] = useState<ScoreLayer[]>(["total", "sync", "route"]);
  const selected = EVENT_DATA.find((event) => event.id === selectedId) ?? EVENT_DATA[0];
  const [draftEdits, setDraftEdits] = useState(state.investigationEdits);
  const currentEdit = draftEdits[selected.id] ?? state.investigationEdits[selected.id] ?? { note: "", templateId: state.templates.find((item) => item.family.toLowerCase() === selected.family)?.id ?? "" };

  const events = useMemo(() => EVENT_DATA.filter((event) => familyFilter === "all" || event.family === familyFilter), [familyFilter]);

  const loadRange = () => {
    if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום"); return; }
    setLoading(true); setLoaded(false); setProgress(4);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + Math.max(3, Math.round((100 - value) / 7)));
      if (next >= 100) {
        window.clearInterval(timer);
        window.setTimeout(() => { setLoading(false); setLoaded(true); toast.success("הטווח נטען וחושב מחדש"); }, 350);
      }
      return next;
    }), 180);
  };

  const saveEdit = async () => {
    const next = { ...state, investigationEdits: { ...state.investigationEdits, [selected.id]: currentEdit } };
    await save(next, "investigation", "event-edit", `${selected.group} · ${selected.time}`);
  };

  const familyColor = selected.family === "si" ? "#22cbb8" : "#ff9f43";

  return (
    <div className="investigation-workspace">
      <section className="investigation-filter glass-panel">
        <div><p className="eyebrow">תחקור לאחור</p><h2>שרת וטווח זמן</h2><p>טוען נתונים חסרים, מחשב אירועים ומציג את הגרסה האחרונה.</p></div>
        <div className="investigation-controls">
          <label><span>מספר שרת</span><Select value={server} onValueChange={onServerChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
          <label><span>מתאריך</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>עד תאריך</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <Button onClick={loadRange} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "טוען…" : "טען טווח"}</Button>
        </div>
        {loading && <div className="range-progress"><Progress value={progress} /><span>{progress}% · {progress < 35 ? "שולף נתונים" : progress < 72 ? "מזהה נתיבים וקבוצות" : "מחשב ציונים ואירועים"}</span></div>}
      </section>

      <section className="investigation-timeline glass-panel">
        <div className="section-toolbar"><div><p className="eyebrow">ציר זמן</p><h2>{loaded ? `${events.length} אירועים בטווח` : "ממתין לנתונים"}</h2></div><div className="toolbar-actions"><div className="segmented-control"><button type="button" className={familyFilter === "all" ? "active" : ""} onClick={() => setFamilyFilter("all")}>הכול</button><button type="button" className={familyFilter === "si" ? "active" : ""} onClick={() => setFamilyFilter("si")}>SI</button><button type="button" className={familyFilter === "so" ? "active" : ""} onClick={() => setFamilyFilter("so")}>SO</button></div><Button variant="outline" size="sm" onClick={() => downloadJson(`bluewolf-server-${server}.json`, { server, from, to, events })}><Download />נתונים</Button><Button size="sm" onClick={() => { toast.info("נפתחה תצוגת הדפסה; בחר שמירה כ־PDF"); window.setTimeout(() => window.print(), 350); }}><FileDown />דוח PDF</Button></div></div>
        <TimelineChart selected={selected.family} layers={layers} cursor={cursor} onCursor={setCursor} />
        <div className="timeline-footer"><span><CalendarRange />{from.replace("T", " ")} – {to.replace("T", " ")}</span><span><SlidersHorizontal />ציונים כוללים, סנכרון ונתיב</span></div>
      </section>

      <div className="investigation-main">
        <section className="event-list glass-panel">
          <div className="list-title"><div><p className="eyebrow">אירועים</p><h2>לפי זמן</h2></div><Filter /></div>
          <div className="event-list-scroll">{events.map((event) => {
            const color = event.score >= 80 ? "#22cbb8" : event.score < 50 ? "#ef6b73" : "#f6bf4f";
            return <button type="button" className={`event-row ${selected.id === event.id ? "active" : ""}`} key={event.id} onClick={() => setSelectedId(event.id)}><EventMiniMap family={event.family} color={color} /><div><span>{event.time}</span><strong>{event.group} · {event.quality}</strong><p>{event.reason}</p></div><ScoreRing value={event.score} color={color} size="small" /></button>;
          })}</div>
        </section>

        <section className="event-detail glass-panel">
          <div className="section-toolbar"><div><p className="eyebrow">אירוע נבחר · {selected.time}</p><h2>{selected.group} · {selected.quality}</h2></div><div className="event-score-summary"><span>סנכרון <b>{selected.sync}</b></span><span>נתיב <b>{selected.route}</b></span><ScoreRing value={selected.score} color={familyColor} /></div></div>
          <div className="investigation-map-wrap">
            <LiveMap tick={cursor * 3} selectedGroup={selected.family} selectedVehicle={null} showTrace showRoutes showRelations showGrid onSelectGroup={() => undefined} onSelectVehicle={(id) => toast.info(`רכב ${id}: ציון כולל ${Math.max(0, selected.score + ((id % 5) - 2))}`)} />
            {loading && <MapLoadingOverlay progress={progress} label="מחשב מחדש את האירוע" />}
          </div>
          <div className="event-score-table">
            <div className="table-head"><span>רכב</span><span>כולל</span><span>סנכרון</span><span>נתיב</span><span>גורם מוביל</span></div>
            {selected.members.map((member, index) => <div className="table-row" key={member}><strong>{member}</strong><span>{Math.max(0, selected.score + 3 - index * 4)}</span><span>{Math.max(0, selected.sync + 4 - index * 5)}</span><span>{Math.max(0, selected.route + 2 - index * 3)}</span><span>{selected.family === "so" && index === 1 ? "תזמון פנייה" : selected.family === "si" ? "הפרש זווית" : "פאזה"}</span></div>)}
          </div>
          <div className="event-editor">
            <label><span>תבנית שחלה בפועל</span><Select value={currentEdit.templateId} onValueChange={(templateId) => setDraftEdits({ ...draftEdits, [selected.id]: { ...currentEdit, templateId } })}><SelectTrigger><SelectValue placeholder="בחר תבנית" /></SelectTrigger><SelectContent>{state.templates.filter((item) => item.family.toLowerCase() === selected.family).map((item) => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="note-field"><span><MessageSquareText /> הערת מפעיל</span><Textarea value={currentEdit.note} onChange={(event) => setDraftEdits({ ...draftEdits, [selected.id]: { ...currentEdit, note: event.target.value } })} placeholder="הוסף הערה שתופיע בתחקור ובדוח…" /></label>
            <Button onClick={saveEdit}><Save />שמור עריכה</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
