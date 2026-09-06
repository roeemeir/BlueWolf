"use client";

import type { AnalysisFrame } from "./navigation-history";
import { GROUP_COLORS, type V12GroupKey } from "./map";

export type V12TimelineLayer = "total" | "sync" | "route";
const STYLE: Record<V12TimelineLayer,{width:number;dash?:string;label:string}>={total:{width:4.2,label:"כולל"},sync:{width:2.5,dash:"10 6",label:"סנכרון"},route:{width:2.3,dash:"2 7",label:"נתיב"}};
function timeLabel(value:string){return new Intl.DateTimeFormat("he-IL",{hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
export function V12Timeline({history,layers,groups,cursor,onCursor}:{history:AnalysisFrame[];layers:V12TimelineLayer[];groups:V12GroupKey[];cursor:number;onCursor:(value:number)=>void}){
  const left=56,right=1040,top=24,bottom=246;const x=(index:number)=>left+index/Math.max(1,history.length-1)*(right-left);const y=(score:number)=>bottom-score/100*(bottom-top);const safe=Math.max(0,Math.min(history.length-1,cursor));
  const path=(group:V12GroupKey,layer:V12TimelineLayer)=>history.map((frame,index)=>`${index?"L":"M"}${x(index).toFixed(1)},${y(frame.analysis.groups[group].score[layer]).toFixed(1)}`).join(" ");
  const ticks=history.length?Array.from({length:Math.min(6,history.length)},(_,i)=>Math.round(i*(history.length-1)/Math.max(1,Math.min(5,history.length-1)))):[];
  return <div className="v09-timeline-wrap"><svg className="v09-timeline" viewBox="0 0 1100 330" role="img" aria-label="ציר ציונים שחושב מדגימות ניווט" onClick={(event)=>{const rect=event.currentTarget.getBoundingClientRect();const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));onCursor(Math.round(ratio*Math.max(0,history.length-1)));}}>
    {[0,25,50,75,100].map((score)=><g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="v09-chart-grid"/><text x="44" y={y(score)+4} textAnchor="end" className="v09-chart-label">{score}</text></g>)}
    {groups.flatMap((group)=>layers.map((layer)=><path key={`${group}-${layer}`} d={path(group,layer)} fill="none" stroke={GROUP_COLORS[group]} strokeWidth={STYLE[layer].width} strokeDasharray={STYLE[layer].dash} strokeLinecap="round"/>))}
    {history.length>0&&<line x1={x(safe)} x2={x(safe)} y1={top} y2={bottom} className="v09-cursor-line"/>}
    {ticks.map((index)=><g key={index}><line x1={x(index)} x2={x(index)} y1={bottom} y2={bottom+5} className="v09-chart-tick"/><text x={x(index)} y="270" textAnchor="middle" className="v09-chart-label">{timeLabel(history[index].timestamp)}</text></g>)}
    <g transform="translate(62 296)" className="v09-group-legend"><circle cx="7" cy="0" r="6" fill={GROUP_COLORS.si}/><text x="20" y="4">SI</text><circle cx="95" cy="0" r="6" fill={GROUP_COLORS.so}/><text x="108" y="4">SO</text></g>
    <g transform="translate(360 296)" className="v09-style-legend">{layers.map((layer,index)=><g key={layer} transform={`translate(${index*170} 0)`}><line x1="0" x2="34" y1="0" y2="0" stroke="currentColor" strokeWidth={STYLE[layer].width} strokeDasharray={STYLE[layer].dash}/><text x="44" y="4">{STYLE[layer].label}</text></g>)}</g>
  </svg><div className="v09-timeline-caption"><span>{history.length} נקודות ניתוח</span><span>כל נקודה הופקה מחלון דגימות ניווט — אין סדרת score סינתטית נפרדת.</span></div></div>;
}
