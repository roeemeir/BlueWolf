"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Check,
  Crosshair,
  Expand,
  Eye,
  Focus,
  History,
  Layers3,
  Pause,
  Play,
  RefreshCw,
  Route,
  Satellite,
  ScanLine,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { DEMO_GROUPS, LiveMap, ScoreRing, TimelineChart, type GroupKey, type ScoreLayer } from "./visuals";

function GroupCard({ groupKey, selected, onSelect }: { groupKey: GroupKey; selected: boolean; onSelect: () => void }) {
  const group = DEMO_GROUPS[groupKey];
  const quality = group.total >= 80 ? "טוב" : group.total < 50 ? "נמוך" : "בינוני";
  return (
    <button type="button" className={`group-card glass-panel ${selected ? "active" : ""}`} onClick={onSelect}>
      <div className="group-card-head">
        <div><span className={`status-dot ${groupKey}`} /><strong>{group.name}</strong><p>{group.family}</p></div>
        <ScoreRing value={group.total} color={group.colorHex} />
      </div>
      <div className="score-trio"><span>סנכרון<b>{group.sync}</b></span><span>נתיב<b>{group.route}</b></span><span>אמינות<b>{group.confidence}%</b></span></div>
      <div className={`reason-line ${groupKey === "so" ? "warning" : ""}`}><span>{quality}</span>{group.reason}</div>
      <div className="member-chips">{group.members.map((member) => <span key={member}>{member}</span>)}</div>
    </button>
  );
}

function VehicleDetail({ id, groupKey, onClose }: { id: number; groupKey: GroupKey; onClose: () => void }) {
  const group = DEMO_GROUPS[groupKey];
  const offset = (id % 7) - 3;
  return (
    <section className="vehicle-detail glass-panel">
      <header><div><span className={`status-dot ${groupKey}`} /><strong>רכב {id}</strong><p>{id < 200 ? "סער" : "ברק"} · פעיל</p></div><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="סגירת פירוט רכב"><X /></Button></header>
      <div className="vehicle-score-row"><ScoreRing value={Math.max(0, group.total + offset)} color="#9b6bff" size="small" /><div><span>גורם מוביל</span><strong>{groupKey === "so" && id === 212 ? "תזמון פנייה" : "מיקום יחסי"}</strong><p>{groupKey === "so" && id === 212 ? "איחור 14 שניות" : "בתוך תחום 100%"}</p></div></div>
      <dl><div><dt>מהירות</dt><dd>{id < 200 ? "42" : "51"} קמ״ש</dd></div><div><dt>מחזור</dt><dd>04:18 דק׳</dd></div><div><dt>פאזה</dt><dd>{((id * 17) % 100)}%</dd></div><div><dt>אמינות</dt><dd>{group.confidence}%</dd></div></dl>
    </section>
  );
}

export function OperatorView({ serverName, onInvestigate }: { serverName: string; onInvestigate: () => void }) {
  const [selectedGroup, setSelectedGroup] = useState<GroupKey>("so");
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [showTrace, setShowTrace] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showRelations, setShowRelations] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [satellite, setSatellite] = useState(false);
  const [layers, setLayers] = useState<ScoreLayer[]>(["sync"]);
  const [cursor, setCursor] = useState(59);
  const [alertAcknowledged, setAlertAcknowledged] = useState(false);
  const [muteLabel, setMuteLabel] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { setTick((current) => current + 1); setCursor(59); }, 170);
    return () => window.clearInterval(timer);
  }, [running]);

  const selected = DEMO_GROUPS[selectedGroup];
  const layerLabels: Record<ScoreLayer, string> = { total: "כולל", sync: "סנכרון", route: "נתיב" };
  const toggleLayer = (layer: ScoreLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => { setRefreshing(false); setTick((value) => value + 1); toast.success("הנתונים החיים עודכנו"); }, 700);
  };

  const enterFullscreen = async () => {
    try { await mapRef.current?.requestFullscreen(); } catch { toast.info("הדפדפן חסם מעבר למסך מלא"); }
  };

  const chooseMute = (label: string) => {
    setMuteLabel(label);
    toast.success(`כל הצלילים הושתקו: ${label}`);
  };

  const activeScore = useMemo(() => {
    const base = selected.total;
    return selectedVehicle ? Math.max(0, Math.min(100, base + ((selectedVehicle % 7) - 3))) : base;
  }, [selected, selectedVehicle]);

  return (
    <div className={`operator-workspace ${satellite ? "satellite-mode" : ""}`}>
      <section className="live-map-panel glass-panel" ref={mapRef}>
        <div className="section-toolbar">
          <div><p className="eyebrow">מפה חיה</p><h2>{serverName} · זירת הדגמה</h2></div>
          <div className="toolbar-actions">
            <label className="switch-label"><Switch checked={showRoutes} onCheckedChange={setShowRoutes} /> נתיבים</label>
            <label className="switch-label"><Switch checked={showTrace} onCheckedChange={setShowTrace} /> עקבות</label>
            <Button variant="outline" size="sm" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}{running ? "השהה" : "המשך"}</Button>
            <Button variant="outline" size="icon-sm" onClick={enterFullscreen} aria-label="מסך מלא"><Expand /></Button>
          </div>
        </div>
        <div className="map-stage">
          <LiveMap tick={tick} selectedGroup={selectedGroup} selectedVehicle={selectedVehicle} showTrace={showTrace} showRoutes={showRoutes} showRelations={showRelations} showGrid={showGrid} onSelectGroup={(group) => { setSelectedGroup(group); setSelectedVehicle(null); }} onSelectVehicle={(id, group) => { setSelectedGroup(group); setSelectedVehicle(id); }} />
          <div className="map-floating top-start"><ScanLine /> סימולציה חיה <span>5 שנ׳</span></div>
          <div className="map-layer-dock glass-panel">
            <Button variant={satellite ? "secondary" : "ghost"} size="icon-sm" onClick={() => { setSatellite((value) => !value); toast.info(satellite ? "מפת הנדסה פעילה" : "שכבת תצלום הודגמה"); }} aria-label="החלפת מפת רקע"><Satellite /></Button>
            <Button variant={showGrid ? "secondary" : "ghost"} size="icon-sm" onClick={() => setShowGrid((value) => !value)} aria-label="רשת קואורדינטות"><Layers3 /></Button>
            <Button variant={showRelations ? "secondary" : "ghost"} size="icon-sm" onClick={() => setShowRelations((value) => !value)} aria-label="יחסי סנכרון"><Route /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => toast.success(`המפה ממוקדת על ${selected.name}`)} aria-label="מיקוד בקבוצה"><Crosshair /></Button>
          </div>
          <div className="map-floating bottom-end"><Focus /> מיקוד: {selected.name}</div>
        </div>
      </section>

      <aside className="live-summary">
        <div className="summary-heading"><div><p className="eyebrow">תמונת מצב</p><h2>2 קבוצות פעילות</h2></div><Button variant="outline" size="icon-sm" onClick={refresh} aria-label="רענון נתונים"><RefreshCw className={refreshing ? "spin" : ""} /></Button></div>
        {!alertAcknowledged && <div className="active-alert glass-panel"><TriangleAlert /><div><strong>סנכרון בינוני ב־SO-02</strong><p>רכב 212 נכנס לפנייה מאוחר ביחס לתבנית הפעילה.</p></div><Button size="sm" variant="outline" onClick={() => { setAlertAcknowledged(true); toast.success("ההתראה אושרה; החיווי נשאר עד התאוששות"); }}><Check />אושר</Button></div>}
        {alertAcknowledged && <button type="button" className="acknowledged-alert" onClick={() => setAlertAcknowledged(false)}><BellRing /> התראה מאושרת · לחיצה להצגה מחדש</button>}
        <GroupCard groupKey="so" selected={selectedGroup === "so"} onSelect={() => { setSelectedGroup("so"); setSelectedVehicle(null); }} />
        <GroupCard groupKey="si" selected={selectedGroup === "si"} onSelect={() => { setSelectedGroup("si"); setSelectedVehicle(null); }} />
        {selectedVehicle && <VehicleDetail id={selectedVehicle} groupKey={selectedGroup} onClose={() => setSelectedVehicle(null)} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" className="wide-button">{muteLabel ? <VolumeX /> : <Volume2 />}{muteLabel ? `מושתק · ${muteLabel}` : "השתקת התראות"}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-menu"><DropdownMenuLabel>השתקת כל הצלילים</DropdownMenuLabel><DropdownMenuSeparator />{["5 דקות", "15 דקות", "30 דקות", "עד הפעלה מחדש"].map((label) => <DropdownMenuItem key={label} onClick={() => chooseMute(label)}>{label}</DropdownMenuItem>)}{muteLabel && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => { setMuteLabel(null); toast.success("הצלילים הופעלו"); }}><Volume2 />הפעל צלילים</DropdownMenuItem></>}</DropdownMenuContent>
        </DropdownMenu>
      </aside>

      <section className="timeline-panel glass-panel">
        <div className="section-toolbar timeline-toolbar">
          <div><p className="eyebrow">השעה האחרונה</p><h2>{selected.name} · ציון {activeScore}</h2></div>
          <div className="chart-controls">
            <div className="segmented-control">{(["total", "sync", "route"] as ScoreLayer[]).map((layer) => <button type="button" key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layerLabels[layer]}</button>)}</div>
            <Button variant="outline" size="sm" onClick={onInvestigate}><History />תחקור</Button>
          </div>
        </div>
        <TimelineChart selected={selectedGroup} layers={layers} cursor={cursor} onCursor={(value) => { setCursor(value); if (value < 59) setRunning(false); }} selectedVehicle={selectedVehicle} />
        <div className="timeline-footer"><span><i className="quality good" />טוב 80–100</span><span><i className="quality medium" />בינוני 50–79</span><span><i className="quality low" />נמוך 0–49</span><span className="timeline-hint"><Eye />גרירה על הגרף מזיזה את סמן הזמן</span></div>
      </section>
    </div>
  );
}
