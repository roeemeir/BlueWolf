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
import { WorkspaceProvider, useWorkspace } from "./app-context";
import { DeveloperViewV09 } from "./developer-view-v09";
import { InvestigationViewV091 } from "./investigation-view-v091";
import { OperatorViewV09 } from "./operator-view-v09";
import { LoadingScreen } from "./visuals-v09";
import { WolfLogo } from "./wolf-logo";

type MainTab = "operator" | "investigation" | "developer";

function AppInner() {
  const { state, ready, loadProgress, storageMode, revision } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const [clock, setClock] = useState("--:--:--");
  const [server, setServer] = useState("1");
  const [dataMode, setDataMode] = useState<DataMode>("simulation");
  const [tab, setTab] = useState<MainTab>("operator");
  const [notifications, setNotifications] = useState([
    { id: 1, tone: "warning", title: "SO-02 · התראה חיה", detail: "איחור בפנייה — לא נוצר אירוע תחקור חדש", time: "עכשיו", read: false },
    { id: 2, tone: "info", title: "נתיב זוהה", detail: "הנתיב האפקטיבי עודכן", time: "לפני 4 דק׳", read: false },
    { id: 3, tone: "success", title: "QA", detail: "בדיקות SRS/CI אחרונות", time: "לפני 12 דק׳", read: true },
  ]);

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat("he-IL", { timeZone: state.settings.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [state.settings.timezone]);

  const serverValue = state.servers.some((item) => item.id === server && item.enabled) ? server : (state.servers.find((item) => item.enabled)?.id ?? "1");
  const activeServer = useMemo(() => state.servers.find((item) => item.id === serverValue)?.name ?? `שרת ${serverValue}`, [serverValue, state.servers]);
  const unread = notifications.filter((item) => !item.read).length;

  if (!ready) return <LoadingScreen progress={loadProgress} />;

  return <main className="app-shell v04-shell v09-shell">
    <header className="topbar glass-panel">
      <button type="button" className="brand" onClick={() => setTab("operator")}><div className="brand-mark"><WolfLogo /></div><div><h1>זאב כחול</h1><p>ניטור סנכרון רכבים</p></div></button>
      <Dialog>
        <DialogTrigger asChild><button type="button" className={`live-state source-${dataMode}`}><span className="live-dot" /><div><strong>חי · {dataMode === "simulation" ? "סימולציה" : "InfluxDB"}</strong><small>מקור נתונים בלבד</small></div></button></DialogTrigger>
        <DialogContent className="glass-dialog source-dialog" dir="rtl"><DialogHeader><DialogTitle>מקור הנתונים</DialogTitle><DialogDescription>בחירת מקור אינה משנה שרת או זירה.</DialogDescription></DialogHeader><div className="source-choice-grid"><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => setDataMode("simulation")}><Radio /><strong>סימולציה</strong><span>תרחיש שונה לכל שרת</span></button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => setDataMode("influx")}><Database /><strong>InfluxDB 2</strong><span>לפי המיפוי הפעיל</span></button></div><div className="system-dialog-grid"><span><HardDrive />אחסון<b>{storageMode === "cloud" ? "מרכזי" : "מקומי"}</b></span><span><CheckCircle2 />קונפיגורציה<b>גרסה {revision || 1}</b></span><span><Clock3 />טיק<b>5 שניות</b></span></div></DialogContent>
      </Dialog>
      <div className="top-actions">
        <label className="v04-server-control"><span>שרת</span><Select value={serverValue} onValueChange={(value) => { setServer(value); toast.success(`עברת ל${state.servers.find((item) => item.id === value)?.name ?? value}`); }}><SelectTrigger className="server-select"><Database /><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
        <div className="clock"><Clock3 />{clock}</div><Button variant="outline" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? <Sun /> : <Moon />}</Button>
        <Sheet><SheetTrigger asChild><Button variant="outline" size="icon"><Bell />{unread > 0 && <span className="notification-count">{unread}</span>}</Button></SheetTrigger><SheetContent side="left" className="notification-sheet glass-sheet" dir="rtl"><SheetHeader><SheetTitle>התראות חיות</SheetTitle><SheetDescription>התראות הן ישות נפרדת מאירועי תחקור</SheetDescription></SheetHeader><div className="notification-list">{notifications.map((item) => <button type="button" key={item.id} className={`notification-item ${item.read ? "read" : ""}`} onClick={() => setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry))}><span className={`notification-icon ${item.tone}`}>{item.tone === "warning" ? <TriangleAlert /> : item.tone === "success" ? <CheckCircle2 /> : <Info />}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></button>)}</div></SheetContent></Sheet>
      </div>
    </header>

    <Tabs value={tab} onValueChange={(value) => setTab(value as MainTab)} dir="rtl" className="main-tabs">
      <div className="nav-row glass-panel"><TabsList variant="line"><TabsTrigger value="operator"><Activity />מבצעי</TabsTrigger><TabsTrigger value="investigation"><FileChartColumn />תחקור</TabsTrigger><TabsTrigger value="developer"><Settings2 />מפתחים</TabsTrigger></TabsList><div className="nav-status"><span><Wifi />{activeServer}</span><span className={`mode-chip ${dataMode}`}>{dataMode === "simulation" ? "SIM" : "INFLUX"}</span><Badge variant="outline">v0.9 SRS</Badge></div></div>
      <TabsContent value="operator"><OperatorViewV09 key={serverValue} serverId={serverValue} serverName={activeServer} dataMode={dataMode} onDataModeChange={setDataMode} onInvestigate={() => setTab("investigation")} /></TabsContent>
      <TabsContent value="investigation"><InvestigationViewV091 server={serverValue} onServerChange={setServer} /></TabsContent>
      <TabsContent value="developer"><DeveloperViewV09 /></TabsContent>
    </Tabs>
  </main>;
}

export function DashboardApp() { return <WorkspaceProvider><AppInner /></WorkspaceProvider>; }
