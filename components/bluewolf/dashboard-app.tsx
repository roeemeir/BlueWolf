"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  CheckCircle2,
  Clock3,
  Database,
  FileChartColumn,
  HardDrive,
  Info,
  Moon,
  Radio,
  Settings2,
  Sun,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeveloperView } from "./developer-view";
import { InvestigationView } from "./investigation-view";
import { LoadingScreen } from "./visuals";
import { OperatorView } from "./operator-view";
import { WolfLogo } from "./wolf-logo";
import { WorkspaceProvider, useWorkspace } from "./app-context";
import type { DataMode } from "@/lib/bluewolf";

type MainTab = "operator" | "investigation" | "developer";

function AppInner() {
  const { state, ready, loadProgress, storageMode, revision } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const [clock, setClock] = useState("--:--:--");
  const [server, setServer] = useState("1");
  const [dataMode, setDataMode] = useState<DataMode>("simulation");
  const [tab, setTab] = useState<MainTab>("operator");
  const [notifications, setNotifications] = useState([
    { id: 1, tone: "warning", title: "SO-02 · סנכרון בינוני", detail: "רכב 212 נכנס לפנייה באיחור", time: "עכשיו", read: false },
    { id: 2, tone: "info", title: "SI-01 · נתיב מזוהה", detail: "התאמה ל׳טבעת צפונית׳", time: "לפני 4 דק׳", read: false },
    { id: 3, tone: "success", title: "בדיקת מערכת", detail: "43 בדיקות הליבה עברו", time: "לפני 12 דק׳", read: true },
  ]);

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat("he-IL", { timeZone: state.settings.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [state.settings.timezone]);
  const serverValue = state.servers.some((item) => item.id === server && item.enabled) ? server : (state.servers.find((item) => item.enabled)?.id ?? "1");
  const activeServer = useMemo(() => state.servers.find((item) => item.id === serverValue)?.name ?? `שרת ${serverValue}`, [serverValue, state.servers]);
  const unread = notifications.filter((item) => !item.read).length;
  const toggleTheme = () => { const next = resolvedTheme === "dark" ? "light" : "dark"; setTheme(next); toast.success(next === "dark" ? "מצב כהה הופעל" : "מצב בהיר הופעל"); };

  if (!ready) return <LoadingScreen progress={loadProgress} />;

  return (
    <main className="app-shell">
      <header className="topbar glass-panel">
        <button type="button" className="brand" onClick={() => { setTab("operator"); toast.info("חזרה למסך המבצעי"); }} aria-label="חזרה למסך המבצעי"><div className="brand-mark"><WolfLogo /></div><div><h1>זאב כחול</h1><p>ניטור סנכרון רכבים</p></div></button>
        <Dialog><DialogTrigger asChild><button type="button" className={`live-state source-${dataMode}`}><span className="live-dot" /><div><strong>חי · {dataMode === "simulation" ? "סימולציה" : "InfluxDB"}</strong><small>לחיצה להחלפת מקור · טיק 5 שנ׳</small></div></button></DialogTrigger><DialogContent className="glass-dialog source-dialog" dir="rtl"><DialogHeader><DialogTitle>מקור הנתונים הפעיל</DialogTitle><DialogDescription>הבחירה ברורה בכל המסכים. סימולציה מפעילה תרחיש דטרמיניסטי; Influx משתמש במיפוי וב־Token שהוגדרו במצב מפתחים.</DialogDescription></DialogHeader><div className="source-choice-grid"><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => { setDataMode("simulation"); toast.success("מצב סימולציה הופעל"); }}><Radio /><strong>סימולציה</strong><span>נתונים מחזוריים לבדיקת מפה, תבניות והתראות</span><b>{dataMode === "simulation" ? "פעיל עכשיו" : "הפעל"}</b></button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => { setDataMode("influx"); toast.success("מצב InfluxDB הופעל"); }}><Database /><strong>InfluxDB 2</strong><span>שרת אמיתי לפי המיפוי וה־Token המוגדרים</span><b>{dataMode === "influx" ? "פעיל עכשיו" : "הפעל"}</b></button></div><div className="system-dialog-grid"><span><HardDrive />אחסון<b>{storageMode === "cloud" ? "מרכזי" : "מקומי"}</b></span><span><CheckCircle2 />ליבה<b>43/43 בדיקות</b></span><span><Database />קונפיגורציה<b>גרסה {revision || 1}</b></span><span><Clock3 />קצב עיבוד<b>5 שניות קשיח</b></span></div></DialogContent></Dialog>
        <div className="top-actions">
          <Select value={serverValue} onValueChange={(value) => { setServer(value); toast.success(`עברת ל${state.servers.find((item) => item.id === value)?.name ?? value}`); }}><SelectTrigger className="server-select"><Database /><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.arena}</SelectItem>)}</SelectContent></Select>
          <div className="clock"><Clock3 />{clock}</div>
          <Button variant="outline" size="icon" onClick={toggleTheme} aria-label="החלפת מצב צבע">{resolvedTheme === "dark" ? <Sun /> : <Moon />}</Button>
          <Sheet><SheetTrigger asChild><Button variant="outline" size="icon" aria-label="פתיחת התראות"><Bell />{unread > 0 && <span className="notification-count">{unread}</span>}</Button></SheetTrigger><SheetContent side="left" className="notification-sheet glass-sheet" dir="rtl"><SheetHeader><SheetTitle>מרכז התראות</SheetTitle><SheetDescription>{unread} התראות חדשות ב־{activeServer}</SheetDescription></SheetHeader><div className="notification-list">{notifications.map((item) => <button type="button" key={item.id} className={`notification-item ${item.read ? "read" : ""}`} onClick={() => { setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, read: true } : notification)); setTab("operator"); toast.info(item.title); }}><span className={`notification-icon ${item.tone}`}>{item.tone === "warning" ? <TriangleAlert /> : item.tone === "success" ? <CheckCircle2 /> : <Info />}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></button>)}</div><Button variant="outline" onClick={() => { setNotifications((current) => current.map((item) => ({ ...item, read: true }))); toast.success("כל ההתראות סומנו כנקראו"); }}>סמן הכול כנקרא</Button></SheetContent></Sheet>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as MainTab)} dir="rtl" className="main-tabs">
        <div className="nav-row glass-panel"><TabsList variant="line"><TabsTrigger value="operator"><Activity />מבצעי</TabsTrigger><TabsTrigger value="investigation"><FileChartColumn />תחקור לאחור</TabsTrigger><TabsTrigger value="developer"><Settings2 />מפתחים</TabsTrigger></TabsList><div className="nav-status"><span><Wifi />{activeServer}</span><span className={`mode-chip ${dataMode}`}>{dataMode === "simulation" ? "SIM" : "INFLUX"}</span><span><CheckCircle2 />ליבה תקינה</span><Badge variant="outline">v0.3</Badge></div></div>
        <TabsContent value="operator"><OperatorView key={serverValue} serverId={serverValue} serverName={activeServer} dataMode={dataMode} onDataModeChange={setDataMode} onInvestigate={() => setTab("investigation")} /></TabsContent>
        <TabsContent value="investigation"><InvestigationView server={serverValue} onServerChange={setServer} /></TabsContent>
        <TabsContent value="developer"><DeveloperView /></TabsContent>
      </Tabs>
    </main>
  );
}

export function DashboardApp() {
  return <WorkspaceProvider><AppInner /></WorkspaceProvider>;
}
