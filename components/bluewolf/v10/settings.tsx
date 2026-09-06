"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "../app-context";
import { V09Settings } from "../v09/infra-settings";
import { DEFAULT_SO_GROUPING } from "./grouping";

export function V10Settings(){
  const {state,save}=useWorkspace();
  const current=state.settings as typeof state.settings&{trailHistoryMinutes?:number;soGroupingMaxParallelLegs?:number;soGroupingMaxLateralLegs?:number;soGroupingMaxAngleDeg?:number};
  const [trail,setTrail]=useState(current.trailHistoryMinutes??30);const [parallel,setParallel]=useState(current.soGroupingMaxParallelLegs??DEFAULT_SO_GROUPING.maxParallelLegs);const [lateral,setLateral]=useState(current.soGroupingMaxLateralLegs??DEFAULT_SO_GROUPING.maxLateralLegs);const [angle,setAngle]=useState(current.soGroupingMaxAngleDeg??DEFAULT_SO_GROUPING.maxAngleDeg);
  const saveSettings=async()=>{const nextSettings={...state.settings,trailHistoryMinutes:Math.max(5,Math.min(240,Math.round(trail))),soGroupingMaxParallelLegs:Math.max(.1,Math.min(3,parallel)),soGroupingMaxLateralLegs:Math.max(.05,Math.min(1,lateral)),soGroupingMaxAngleDeg:Math.max(1,Math.min(45,angle))};await save({...state,settings:nextSettings},"settings","operator-and-grouping-v13",`trail=${nextSettings.trailHistoryMinutes};parallel=${nextSettings.soGroupingMaxParallelLegs};lateral=${nextSettings.soGroupingMaxLateralLegs};angle=${nextSettings.soGroupingMaxAngleDeg}`);toast.success("הגדרות התצוגה וחוקיות הקיבוץ נשמרו");};
  return <div className="v10-settings"><section className="v09-panel v10-live-settings"><div className="v09-panel-head"><div><p className="eyebrow">תצוגה חיה · SRS v1.3</p><h3>עקבה וחוקיות קיבוץ SO</h3><p>המרחק הגדול מותר רק בכיוון המקביל לציר הממוצע של ההיפודרומים. הסטייה הרוחבית נשארת הדוקה.</p></div><button className="primary" onClick={saveSettings}><Save/>שמור</button></div><div className="v10-settings-grid"><label>דקות עקבה<input type="number" min="5" max="240" value={trail} onChange={(event)=>setTrail(Number(event.target.value))}/><small>ברירת מחדל: 30 דקות.</small></label><label>מרחק מקביל מרבי · Leg<input type="number" step="0.05" min="0.1" max="3" value={parallel} onChange={(event)=>setParallel(Number(event.target.value))}/><small>ברירת מחדל: 1.5 Leg בין פניות תואמות.</small></label><label>מרחק רוחבי מרבי · Leg<input type="number" step="0.05" min="0.05" max="1" value={lateral} onChange={(event)=>setLateral(Number(event.target.value))}/><small>ברירת מחדל: 0.35 Leg; אינו מאפשר קירוב אלכסוני.</small></label><label>הפרש חזית מרבי<input type="number" step="1" min="1" max="45" value={angle} onChange={(event)=>setAngle(Number(event.target.value))}/><small>ברירת מחדל: 20° בין צירי ההיפודרומים.</small></label></div><div className="v10-trail-presets">{[15,30,60,120].map((value)=><button key={value} className={trail===value?"active":""} onClick={()=>setTrail(value)}>{value} דק׳</button>)}</div></section><V09Settings/></div>;
}
