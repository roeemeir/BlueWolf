"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Bell, CheckCircle2, Clock3, Database, FileChartColumn, HardDrive, Info, Moon, Radio, Settings2, Sun, TriangleAlert, Wifi } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DataMode } from "@/lib/bluewolf";
import { applyLiveRuntimeSnapshot, fetchLiveRuntimeSnapshot, restoreSimulationScenario, unavailableRuntimeSnapshot, type RuntimeHealth } from "@/lib/live-runtime";
import { applyLiveRuntimeHistory, appendLiveRuntimeHistory, fetchLiveRuntimeHistory } from "@/lib/live-runtime-history";
import { DeveloperView } from "./developer-view";
import { InvestigationView } from "./investigation-view";
import { OperatorView } from "./operator-view";
import { LoadingScreen } from "./visuals";
import { WolfLogo } from "./wolf-logo";
import { WorkspaceProvider, useWorkspace } from "./app-context";

type MainTab = "operator" | "investigation" | "developer";
type RuntimeUiState = RuntimeHealth | "simulation" | "connecting";

function AppInner() {
  const { state, ready, loadProgress, storageMode, revision } = useWorkspace(); const { resolvedTheme, setTheme } = useTheme(); const [clock, setClock] = useState("--:--:--"); const [server, setServer] = useState("1"); const [dataMode, setDataMode] = useState<DataMode>("simulation"); const [tab, setTab] = useState<MainTab>("operator"); const [runtimeState, setRuntimeState] = useState<RuntimeUiState>("simulation"); const [runtimeDetail, setRuntimeDetail] = useState("תרחיש דטרמיניסטי"); const [, setRuntimeRevision] = useState(0); const [notifications, setNotifications] = useState([{ id: 1, tone: "warning", title: "SO-02 · התראה חיה", detail: "איחור בפנייה — לא נוצר אירוע תחקור חדש", time: "עכשיו", read: false }, { id: 2, tone: "info", title: "נתיב זוהה", detail: "הנתיב האפקטיבי עודכן", time: "לפני 4 דק׳", read: false }, { id: 3, tone: "success", title: "QA", detail: "בדיקות הליבה האחרונות עברו", time: "לפני 12 דק׳", read: true }]);
  const serverValue = state.servers.some((item) => item.id === server && item.enabled) ? server : (state.servers.find((item) => item.enabled)?.id ?? "1"); const activeServer = useMemo(() => state.servers.find((item) => item.id === serverValue)?.name ?? `שרת ${serverValue}`, [serverValue, state.servers]); const unread = notifications.filter((item) => !item.read).length; const toggleTheme = () => { const next = resolvedTheme === "dark" ? "light" : "dark"; setTheme(next); };
  const changeDataMode = (mode: DataMode) => {
    if (mode === "simulation") {
      restoreSimulationScenario(serverValue);
      setRuntimeState("simulation");
      setRuntimeDetail("תרחיש דטרמיניסטי");
    } else {
      setRuntimeState("connecting");
      setRuntimeDetail("ממתין ל-snapshot מה-Python Core");
    }
    setDataMode(mode);
  };
  const changeServer = (value: string) => {
    if (dataMode === "simulation") restoreSimulationScenario(value);
    else {
      setRuntimeState("connecting");
      setRuntimeDetail("ממתין ל-snapshot מה-Python Core");
    }
    setServer(value);
    toast.success(`עברת ל${state.servers.find((item) => item.id === value)?.name ?? value}`);
  };
  useEffect(() => { const update = () => setClock(new Intl.DateTimeFormat("he-IL", { timeZone: state.settings.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date())); update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer); }, [state.settings.timezone]);
  useEffect(() => {
    if (dataMode === "simulation") return;
    let cancelled = false;
    const bootstrapHistory = async () => {
      try {
        const history = await fetchLiveRuntimeHistory(serverValue);
        if (cancelled) return;
        applyLiveRuntimeHistory(serverValue, history);
        setRuntimeRevision((value) => value + 1);
      } catch {
        // History is optional for liveness: latest snapshots continue to drive the operator.
      }
    };
    const poll = async () => {
      try {
        const snapshot = await fetchLiveRuntimeSnapshot(serverValue);
        if (cancelled) return;
        applyLiveRuntimeSnapshot(snapshot);
        appendLiveRuntimeHistory(snapshot);
        setRuntimeState(snapshot.source.health);
        setRuntimeDetail(snapshot.source.detail ?? `snapshot ${snapshot.observedAt}`);
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : "Python Core runtime is unavailable";
        applyLiveRuntimeSnapshot(unavailableRuntimeSnapshot(serverValue, detail));
        setRuntimeState("unavailable");
        setRuntimeDetail(detail);
      }
      if (!cancelled) setRuntimeRevision((value) => value + 1);
    };
    void bootstrapHistory();
    void poll();
    const timer = window.setInterval(() => void poll(), Math.max(1, state.settings.uiRefreshSeconds) * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [dataMode, serverValue, state.settings.uiRefreshSeconds]);
  const runtimeLabel = dataMode === "simulation" ? "סימולציה" : runtimeState === "healthy" ? "Python Core" : runtimeState === "stale" ? "Core מיושן" : runtimeState === "connecting" ? "מתחבר ל-Core" : "Core לא זמין";
  if (!ready) return <LoadingScreen progress={loadProgress} />;
  return <main className="app-shell v04-shell"><header className="topbar glass-panel"><button type="button" className="brand" onClick={() => setTab("operator")}><div className="brand-mark"><WolfLogo /></div><div><h1>זאב כחול</h1><p>ניטור סנכרון רכבים</p></div></button><Dialog><DialogTrigger asChild><button type="button" className={`live-state source-${dataMode}`}><span className="live-dot" /><div><strong>חי · {runtimeLabel}</strong><small>{runtimeDetail}</small></div></button></DialogTrigger><DialogContent className="glass-dialog source-dialog" dir="rtl"><DialogHeader><DialogTitle>מקור הנתונים</DialogTitle><DialogDescription>בחירת מקור אינה משנה שרת או זירה. במצב Influx הציונים מוצגים רק כאשר Python Core מחזיר snapshot תקף.</DialogDescription></DialogHeader><div className="source-choice-grid"><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => changeDataMode("simulation")}><Radio /><strong>סימולציה</strong><span>תרחיש דטרמיניסטי</span></button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => changeDataMode("influx")}><Database /><strong>InfluxDB 2 + Python Core</strong><span>{dataMode === "influx" ? runtimeLabel : "runtime מבצעי"}</span></button></div><div className="system-dialog-grid"><span><HardDrive />אחסון<b>{storageMode === "cloud" ? "מרכזי" : "מקומי"}</b></span><span><CheckCircle2 />קונפיגורציה<b>גרסה {revision || 1}</b></span><span><Clock3 />טיק<b>{state.settings.uiRefreshSeconds} שניות</b></span></div></DialogContent></Dialog><div className="top-actions"><label className="v04-server-control"><span>שרת</span><Select value={serverValue} onValueChange={changeServer}><SelectTrigger className="server-select"><Database /><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><div className="clock"><Clock3 />{clock}</div><Button variant="outline" size="icon" onClick={toggleTheme}>{resolvedTheme === "dark" ? <Sun /> : <Moon />}</Button><Sheet><SheetTrigger asChild><Button variant="outline" size="icon"><Bell />{unread > 0 && <span className="notification-count">{unread}</span>}</Button></SheetTrigger><SheetContent side="left" className="notification-sheet glass-sheet" dir="rtl"><SheetHeader><SheetTitle>התראות חיות</SheetTitle><SheetDescription>התראות הן ישות נפרדת מאירועי תחקור</SheetDescription></SheetHeader><div className="notification-list">{notifications.map((item) => <button type="button" key={item.id} className={`notification-item ${item.read ? "read" : ""}`} onClick={() => setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry))}><span className={`notification-icon ${item.tone}`}>{item.tone === "warning" ? <TriangleAlert /> : item.tone === "success" ? <CheckCircle2 /> : <Info />}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></button>)}</div></SheetContent></Sheet></div></header><Tabs value={tab} onValueChange={(value) => setTab(value as MainTab)} dir="rtl" className="main-tabs"><div className="nav-row glass-panel"><TabsList variant="line"><TabsTrigger value="operator"><Activity />מבצעי</TabsTrigger><TabsTrigger value="investigation"><FileChartColumn />תחקור</TabsTrigger><TabsTrigger value="developer"><Settings2 />מפתחים</TabsTrigger></TabsList><div className="nav-status"><span><Wifi />{activeServer}</span><span className={`mode-chip ${dataMode}`}>{dataMode === "simulation" ? "SIM" : runtimeState === "healthy" ? "CORE" : "NO CORE"}</span><Badge variant="outline">v0.4 QA</Badge></div></div><TabsContent value="operator"><OperatorView key={serverValue} serverId={serverValue} serverName={activeServer} dataMode={dataMode} onDataModeChange={changeDataMode} onInvestigate={() => setTab("investigation")} /></TabsContent><TabsContent value="investigation"><InvestigationView server={serverValue} onServerChange={setServer} /></TabsContent><TabsContent value="developer"><DeveloperView /></TabsContent></Tabs></main>;
}

export function DashboardApp() { return <WorkspaceProvider><AppInner /></WorkspaceProvider>; }
