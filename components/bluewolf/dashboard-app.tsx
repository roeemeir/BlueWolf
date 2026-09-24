"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { currentRuntimeNotifications } from "@/lib/live-notifications";
import { applyLiveRuntimeSnapshot, fetchLiveRuntimeSnapshot, restoreSimulationScenario, simulationRuntimeSnapshot, unavailableRuntimeSnapshot, type LiveRuntimeSnapshot, type RuntimeHealth } from "@/lib/live-runtime";
import { applyLiveRuntimeHistory, appendLiveRuntimeHistory, fetchLiveRuntimeHistory } from "@/lib/live-runtime-history";
import { createRuntimePollOrder } from "@/lib/runtime-snapshot-order";
import { DeveloperGovernanceWorkbench } from "./developer-governance-workbench";
import { InvestigationWorkspace } from "./investigation-workspace";
import { OperatorView } from "./operator-view";
import { LoadingScreen } from "./visuals";
import { WolfLogo } from "./wolf-logo";
import { WorkspaceProvider, useWorkspace } from "./app-context";

type MainTab = "operator" | "investigation" | "developer";
type RuntimeUiState = RuntimeHealth | "simulation" | "connecting";

function notificationTime(value: string | null, timezone: string) {
  if (!value) return "שעת התחלה לא התקבלה";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "שעת התחלה לא תקינה";
  try {
    return new Intl.DateTimeFormat("he-IL", { timeZone: timezone, dateStyle: "short", timeStyle: "short", hour12: false }).format(date);
  } catch {
    return value;
  }
}

/** Do not mount the legacy operator's demo-group fallbacks as operational evidence. */
export function hasVerifiedOperationalEvidence(snapshot: LiveRuntimeSnapshot | null, serverId: string, nowMs: number, refreshSeconds: number): boolean {
  if (!snapshot || snapshot.serverId !== serverId || snapshot.source.kind !== "python-core" || snapshot.source.health !== "healthy") return false;
  const observedMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 5_000 || nowMs - observedMs > Math.max(30_000, refreshSeconds * 3_000)) return false;
  const groups = snapshot.groupList ?? Object.values(snapshot.groups).filter((group) => Boolean(group));
  return groups.some((group) => group?.scoreValid === true && group.members.some((vehicle) => vehicle.scoreValid === true && typeof vehicle.latitude === "number" && typeof vehicle.longitude === "number" && Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude)));
}

function AppInner() {
  const { state, ready, loadProgress, storageMode, revision } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const [clock, setClock] = useState("--:--:--");
  const [server, setServer] = useState("1");
  const [dataMode, setDataMode] = useState<DataMode>("simulation");
  const [tab, setTab] = useState<MainTab>("operator");
  const [runtimeState, setRuntimeState] = useState<RuntimeUiState>("simulation");
  const [runtimeDetail, setRuntimeDetail] = useState("תרחיש דטרמיניסטי");
  const [coreSnapshot, setCoreSnapshot] = useState<LiveRuntimeSnapshot | null>(null);
  const [readAlertKeys, setReadAlertKeys] = useState<string[]>([]);
  const [, setRuntimeRevision] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  // Keep per-server source timestamps and HTTP completion order across effect
  // restarts. In particular, changing uiRefreshSeconds must not reset history.
  const pollOrder = useRef(createRuntimePollOrder());

  const serverValue = state.servers.some((item) => item.id === server && item.enabled) ? server : (state.servers.find((item) => item.enabled)?.id ?? "1");
  const activeServer = useMemo(() => state.servers.find((item) => item.id === serverValue)?.name ?? `שרת ${serverValue}`, [serverValue, state.servers]);
  const simulationSnapshot = useMemo(() => simulationRuntimeSnapshot(serverValue), [serverValue]);
  const notificationSnapshot = dataMode === "simulation"
    ? simulationSnapshot
    : coreSnapshot?.serverId === serverValue && coreSnapshot.source.kind === "python-core" && coreSnapshot.source.health === "healthy"
      ? coreSnapshot
      : null;
  const notifications = useMemo(() => currentRuntimeNotifications(notificationSnapshot), [notificationSnapshot]);
  const unread = notifications.filter((item) => !readAlertKeys.includes(item.key)).length;

  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const changeDataMode = (mode: DataMode) => {
    // Clear the previous server/mode immediately: a Core outage must never
    // leave a cached alert visible as a current warning for another source.
    setCoreSnapshot(null);
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
    setCoreSnapshot(null);
    if (dataMode === "simulation") restoreSimulationScenario(value);
    else {
      setRuntimeState("connecting");
      setRuntimeDetail("ממתין ל-snapshot מה-Python Core");
    }
    setServer(value);
    toast.success(`עברת ל${state.servers.find((item) => item.id === value)?.name ?? value}`);
  };

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTimeMs(now.getTime());
      setClock(new Intl.DateTimeFormat("he-IL", { timeZone: state.settings.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [state.settings.timezone]);

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
      const requestId = pollOrder.current.begin(serverValue);
      try {
        const snapshot = await fetchLiveRuntimeSnapshot(serverValue);
        if (cancelled) return;
        const healthyCoreFrame = snapshot.source.kind === "python-core" && snapshot.source.health === "healthy";
        // Fresh navigation requires STRICTLY newer source time. A current
        // stale/unavailable response may repeat that time; it updates health
        // by request order WITHOUT adding navigation or operational history.
        const accepted = healthyCoreFrame
          ? pollOrder.current.acceptSnapshot(serverValue, requestId, snapshot.observedAt)
          : pollOrder.current.acceptHealthSnapshot(serverValue, requestId, snapshot.observedAt);
        if (!accepted) return;
        if (healthyCoreFrame) {
          applyLiveRuntimeSnapshot(snapshot);
          appendLiveRuntimeHistory(snapshot);
        } else {
          // Do not leave a stale Core payload's old positive scores or active
          // alerts in runtime group cards. The fallback contains NO GPS evidence.
          applyLiveRuntimeSnapshot(unavailableRuntimeSnapshot(serverValue, snapshot.source.detail ?? "Python Core runtime אינו זמין.", snapshot.observedAt));
        }
        setRuntimeState(snapshot.source.health);
        setRuntimeDetail(snapshot.source.detail ?? `snapshot ${snapshot.observedAt}`);
        setCoreSnapshot(healthyCoreFrame ? snapshot : null);
      } catch (error) {
        if (cancelled || !pollOrder.current.acceptFailure(serverValue, requestId)) return;
        const detail = error instanceof Error ? error.message : "Python Core runtime is unavailable";
        applyLiveRuntimeSnapshot(unavailableRuntimeSnapshot(serverValue, detail));
        setCoreSnapshot(null);
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

  const operationalEvidenceReady = dataMode === "influx" && hasVerifiedOperationalEvidence(coreSnapshot, serverValue, currentTimeMs, state.settings.uiRefreshSeconds);
  const runtimeLabel = dataMode === "simulation" ? "סימולציה" : operationalEvidenceReady ? "Python Core · נתונים מאומתים" : runtimeState === "healthy" ? "Core · נתונים חלקיים" : runtimeState === "stale" ? "Core מיושן" : runtimeState === "connecting" ? "מתחבר ל-Core" : "Core לא זמין";
  if (!ready) return <LoadingScreen progress={loadProgress} />;

  return <main className="app-shell v04-shell">
    <header className="topbar glass-panel">
      <button type="button" className="brand" onClick={() => setTab("operator")}><div className="brand-mark"><WolfLogo /></div><div><h1>זאב כחול</h1><p>ניטור סנכרון רכבים</p></div></button>
      <Dialog>
        <DialogTrigger asChild><button type="button" className={`live-state source-${dataMode}`}><span className="live-dot" /><div><strong>{dataMode === "simulation" ? "SIM · סימולציה" : operationalEvidenceReady ? `חי · ${runtimeLabel}` : `לא מאומת · ${runtimeLabel}`}</strong><small>{runtimeDetail}</small></div></button></DialogTrigger>
        <DialogContent className="glass-dialog source-dialog" dir="rtl"><DialogHeader><DialogTitle>מקור הנתונים</DialogTitle><DialogDescription>בחירת מקור אינה משנה שרת או זירה. במצב Influx הציונים מוצגים רק כאשר Python Core מחזיר snapshot תקף.</DialogDescription></DialogHeader><div className="source-choice-grid"><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => changeDataMode("simulation")}><Radio /><strong>סימולציה</strong><span>תרחיש דטרמיניסטי</span></button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => changeDataMode("influx")}><Database /><strong>InfluxDB 2 + Python Core</strong><span>{dataMode === "influx" ? runtimeLabel : "runtime מבצעי"}</span></button></div><div className="system-dialog-grid"><span><HardDrive />אחסון<b>{storageMode === "cloud" ? "מרכזי" : "מקומי"}</b></span><span><CheckCircle2 />קונפיגורציה<b>גרסה {revision || 1}</b></span><span><Clock3 />טיק<b>{state.settings.uiRefreshSeconds} שניות</b></span></div></DialogContent>
      </Dialog>
      <div className="top-actions">
        <label className="v04-server-control"><span>שרת</span><Select value={serverValue} onValueChange={changeServer}><SelectTrigger className="server-select"><Database /><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
        <div className="clock"><Clock3 />{clock}</div>
        <Button variant="outline" size="icon" onClick={toggleTheme}>{resolvedTheme === "dark" ? <Sun /> : <Moon />}</Button>
        <Sheet>
          <SheetTrigger asChild><Button variant="outline" size="icon" aria-label={`התראות ${dataMode === "simulation" ? "סימולציה" : "Core"}, ${unread} לא נקראו`}><Bell />{unread > 0 && <span className="notification-count">{unread}</span>}</Button></SheetTrigger>
          <SheetContent side="left" className="notification-sheet glass-sheet" dir="rtl">
            <SheetHeader><SheetTitle>התראות {dataMode === "simulation" ? "סימולציה · SIM" : "Python Core"}</SheetTitle><SheetDescription>{dataMode === "simulation" ? "התרעות תרחיש הדמיה בלבד — לא נתונים מבצעיים." : "התראות פעילות מה־snapshot התקף האחרון של השרת הנבחר. התראות אינן אירועי תחקור."}</SheetDescription></SheetHeader>
            <div className="notification-list">
              {notifications.length === 0 && <div className="empty-state"><Info /><strong>{dataMode === "influx" && runtimeState !== "healthy" ? "אין נתוני התראות תקפים מה־Core" : "אין התראות פעילות"}</strong><span>{dataMode === "influx" && runtimeState !== "healthy" ? runtimeDetail : dataMode === "simulation" ? "לתרחיש הסימולציה הנוכחי אין התרעות פעילות." : "לא דווחו התראות פעילות ב־snapshot האחרון."}</span></div>}
              {notifications.map((item) => <button type="button" key={item.key} className={`notification-item ${readAlertKeys.includes(item.key) ? "read" : ""}`} onClick={() => setReadAlertKeys((current) => current.includes(item.key) ? current : [...current, item.key])}>
                <span className={`notification-icon ${item.severity === "critical" ? "warning" : "info"}`}>{item.severity === "critical" ? <TriangleAlert /> : <Info />}</span>
                <div><strong>{item.sourceLabel} · {item.title}</strong><p>{item.detail}</p><small>שרת {item.serverId} · קבוצה {item.groupId} · {notificationTime(item.activeSince, state.settings.timezone)}</small></div>
              </button>)}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
    <Tabs value={tab} onValueChange={(value) => setTab(value as MainTab)} dir="rtl" className="main-tabs">
      <div className="nav-row glass-panel"><TabsList variant="line"><TabsTrigger value="operator"><Activity />מבצעי</TabsTrigger><TabsTrigger value="investigation"><FileChartColumn />תחקור</TabsTrigger><TabsTrigger value="developer"><Settings2 />מפתחים</TabsTrigger></TabsList><div className="nav-status"><span><Wifi />{activeServer}</span><span className={`mode-chip ${dataMode}`}>{dataMode === "simulation" ? "SIM" : operationalEvidenceReady ? "CORE" : "NO CORE SCORE"}</span><Badge variant="outline">v0.4 QA</Badge></div></div>
      <TabsContent value="operator">{dataMode === "simulation" || operationalEvidenceReady
        ? <OperatorView key={`${serverValue}:${dataMode}`} serverId={serverValue} serverName={activeServer} dataMode={dataMode} onDataModeChange={changeDataMode} onInvestigate={() => setTab("investigation")} />
        : <section className="glass-panel empty-state" role="status" aria-label="אין נתונים תפעוליים מאומתים" dir="rtl" style={{ margin: 24, padding: 32 }}><TriangleAlert /><h2>אין נתונים תפעוליים מאומתים</h2><p>לא התקבלה מה־Python Core של השרת הנבחר דגימה עדכנית עם ציון תקף ומיקום רכב נצפה. גם אם הוגדרו פרטי InfluxDB2, אין בכך הוכחה שהמערכת שולפת או מחשבת נתונים חיים.</p><p>{runtimeDetail}</p><p>כרטיסי קבוצות, ציונים וגרפים סינתטיים אינם מוצגים במצב Core. אפשר לבחור במפורש ״סימולציה״ בתפריט מקור הנתונים כדי לבדוק תרחיש הדגמה מסומן.</p></section>}</TabsContent>
      <TabsContent value="investigation"><InvestigationWorkspace server={serverValue} onServerChange={changeServer} dataMode={dataMode} /></TabsContent>
      <TabsContent value="developer"><DeveloperGovernanceWorkbench /></TabsContent>
    </Tabs>
  </main>;
}

export function DashboardApp() { return <WorkspaceProvider><AppInner /></WorkspaceProvider>; }
