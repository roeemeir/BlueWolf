"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Bell, CheckCircle2, Clock3, Database, FileChartColumn, HardDrive, Info, Moon, Radio, Settings2, Sun, TriangleAlert, Wifi } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import type { DataMode } from "@/lib/bluewolf";
import { WorkspaceProvider, useWorkspace } from "./app-context";
import { WolfLogo } from "./wolf-logo";
import { OperatorViewV09 } from "./v09/operator";
import { InvestigationViewV09 } from "./v09/investigation";
import { DeveloperViewV09 } from "./v09/developer";
import { LoadingScreen } from "./visuals";

type MainTab="operator"|"investigation"|"developer";

function AppInner(){const{state,ready,loadProgress,storageMode,revision}=useWorkspace();const{resolvedTheme,setTheme}=useTheme();const[clock,setClock]=useState("--:--:--");const[server,setServer]=useState("1");const[dataMode,setDataMode]=useState<DataMode>("simulation");const[tab,setTab]=useState<MainTab>("operator");const[notifications,setNotifications]=useState([{id:1,tone:"warning",title:"SO · התראה חיה",detail:"איחור בפנייה — לא נוצר Event חדש",time:"עכשיו",read:false},{id:2,tone:"info",title:"Revision candidate",detail:"שינוי גיאומטריה/מחזור בבדיקה",time:"לפני 4 דק׳",read:false},{id:3,tone:"success",title:"SRS v1.1",detail:"Feedback 2026-09-06 נוסף ל־Release Gate",time:"עכשיו",read:false}]);
  useEffect(()=>{const update=()=>setClock(new Intl.DateTimeFormat("he-IL",{timeZone:state.settings.timezone,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()));update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer)},[state.settings.timezone]);
  const serverValue=state.servers.some(item=>item.id===server&&item.enabled)?server:(state.servers.find(item=>item.enabled)?.id??"1");const activeServer=useMemo(()=>state.servers.find(item=>item.id===serverValue)?.name??`שרת ${serverValue}`,[serverValue,state.servers]);const unread=notifications.filter(item=>!item.read).length;if(!ready)return <LoadingScreen progress={loadProgress}/>;return <main className="app-shell v09-shell"><header className="v09-topbar"><button className="v09-brand" onClick={()=>setTab("operator")}><span className="v09-brand-mark"><WolfLogo/></span><span><b>זאב כחול</b><small>v0.9 · SRS v1.1</small></span></button><div className="v09-source"><button onClick={()=>setDataMode(value=>value==="simulation"?"influx":"simulation")}><span className="live-dot"/><span><b>חי · {dataMode==="simulation"?"סימולציה":"InfluxDB"}</b><small>מקור נתונים בלבד</small></span></button><label><span>שרת</span><select value={serverValue} onChange={event=>{setServer(event.target.value);toast.success(`עברת ל${state.servers.find(item=>item.id===event.target.value)?.name??event.target.value}`)}}>{state.servers.filter(item=>item.enabled).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="v09-top-actions"><span className="v09-clock"><Clock3/>{clock}</span><button aria-label="מצב תצוגה" onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")}>{resolvedTheme==="dark"?<Sun/>:<Moon/>}</button><button aria-label="התראות" className="v09-bell" onClick={()=>setNotifications(current=>current.map(item=>({...item,read:true})))}><Bell/>{unread>0&&<i>{unread}</i>}</button></div></header>
    <nav className="v09-main-nav"><button className={tab==="operator"?"active":""} onClick={()=>setTab("operator")}><Activity/>מבצעי</button><button className={tab==="investigation"?"active":""} onClick={()=>setTab("investigation")}><FileChartColumn/>תחקור</button><button className={tab==="developer"?"active":""} onClick={()=>setTab("developer")}><Settings2/>מפתחים</button><div className="v09-nav-status"><span><Wifi/>{activeServer}</span><span><HardDrive/>{storageMode==="cloud"?"מרכזי":"מקומי"}</span><span>Config {revision||1}</span></div></nav>
    {tab==="operator"&&<OperatorViewV09 key={`op-${serverValue}`} serverId={serverValue} serverName={activeServer} dataMode={dataMode} onInvestigate={()=>setTab("investigation")}/>} {tab==="investigation"&&<InvestigationViewV09 key={`inv-${serverValue}`} server={serverValue} onServerChange={setServer}/>} {tab==="developer"&&<DeveloperViewV09/>}
    <aside className="v09-notification-strip" aria-hidden="true">{notifications.slice(0,3).map(item=><span key={item.id} className={item.tone}>{item.tone==="warning"?<TriangleAlert/>:item.tone==="success"?<CheckCircle2/>:<Info/>}{item.title}</span>)}</aside>
  </main>}

export function DashboardAppV09(){return <WorkspaceProvider><AppInner/></WorkspaceProvider>}
