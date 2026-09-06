"use client";

import { useState,type ComponentType } from "react";
import { Activity,Beaker,Database,Layers3,MapPinned,Settings2,ShieldCheck } from "lucide-react";
import { V09ScoreSettings } from "../v09/score-settings";
import { V09Influx } from "../v09/infra-settings";
import { V09RouteBank } from "../v09/route-bank";
import { V10GT } from "../v10/gt";
import { V10Settings } from "../v10/settings";
import { V10TemplateBuilder } from "../v10/template-builder";
import { V12SystemTests } from "./system-tests";

type Section="score"|"templates"|"gt"|"influx"|"routes"|"tests"|"settings";
const sections:{id:Section;label:string;icon:ComponentType<{className?:string}>}[]=[{id:"score",label:"ציון וספים",icon:Activity},{id:"templates",label:"תבניות",icon:Layers3},{id:"gt",label:"GT ו־Sweep",icon:Beaker},{id:"influx",label:"InfluxDB 2",icon:Database},{id:"routes",label:"בנק נתיבים",icon:MapPinned},{id:"tests",label:"בדיקות מערכת",icon:ShieldCheck},{id:"settings",label:"הגדרות",icon:Settings2}];
export function DeveloperViewV12(){const[section,setSection]=useState<Section>("tests");return <div className="v09-developer v12-developer"><nav className="v09-dev-nav">{sections.map((item)=>{const Icon=item.icon;return <button key={item.id} className={section===item.id?"active":""} onClick={()=>setSection(item.id)}><Icon/><span>{item.label}</span></button>})}</nav><main className="v09-dev-content">{section==="score"?<V09ScoreSettings/>:section==="templates"?<V10TemplateBuilder/>:section==="gt"?<V10GT/>:section==="influx"?<V09Influx/>:section==="routes"?<V09RouteBank/>:section==="tests"?<V12SystemTests/>:<V10Settings/>}</main></div>}
