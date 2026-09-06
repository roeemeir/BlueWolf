"use client";

import { useMemo } from "react";

import { pointOnClosed, svgClosedPath } from "../v09/geometry";
import { InvestigationViewV09 } from "../v09/investigation";
import { getV09Scenario } from "../v09/simulator";

const EVENT_COLORS = ["#ef4444", "#f59e0b", "#2563eb", "#8b5cf6", "#10b981", "#ec4899"] as const;

type EvidenceEvent = {
  id: string;
  group: "si" | "so";
  members: number[];
  start: string;
  end: string;
  startReason: string;
  endReason: string;
  color: string;
};

function evidenceEvents(serverId: string): EvidenceEvent[] {
  const scenario = getV09Scenario(serverId, 150);
  const si = scenario.groups.si.members;
  const so = scenario.groups.so.members;
  const joinSi = si.slice(0, 2).map((m) => m.id);
  const extraSi = si[2]?.id;
  const leftSo = so[1]?.id;
  return [
    {
      id: `${serverId}-E1`, group: "si", members: joinSi, start: "17:05", end: "17:34", color: EVENT_COLORS[0],
      startReason: `תחילת אירוע: הרכבים ${joinSi.join(", ")} הצטרפו ונשמרו כקבוצת SI יציבה לאחר חלון האישור.`,
      endReason: extraSi ? `סיום אירוע: רכב ${extraSi} הצטרף לקבוצה; הרכב החברים השתנה ולכן נפתח אירוע חדש.` : "סיום אירוע: שינוי חברות הקבוצה אושר.",
    },
    {
      id: `${serverId}-E2`, group: "si", members: si.map((m) => m.id), start: "17:34", end: "18:18", color: EVENT_COLORS[1],
      startReason: extraSi ? `תחילת אירוע: רכב ${extraSi} הצטרף; הקבוצה החדשה אושרה עם ${si.length} רכבים.` : "תחילת אירוע: קבוצת SI יציבה אושרה.",
      endReason: `סיום אירוע: זמן המחזור השתנה מ־64.2 ל־78.3 שניות (+22.0%) ונשאר מעבר לסף במשך 31 שניות.`,
    },
    {
      id: `${serverId}-E3`, group: "so", members: so.map((m) => m.id), start: "18:24", end: "19:02", color: EVENT_COLORS[2],
      startReason: `תחילת אירוע: הרכבים ${so.map((m) => m.id).join(", ")} זוהו כקבוצת SO יציבה עם גיאומטריה וזמן מחזור תואמים.`,
      endReason: so[0] ? `סיום אירוע: רכב ${so[0].id} חרג מהנתיב 96 מ׳ כאשר הסף הוא 70 מ׳ במשך 42 שניות; החריגה הממושכת אושרה.` : "סיום אירוע: חריגה ממושכת מהנתיב אושרה.",
    },
    {
      id: `${serverId}-E4`, group: "so", members: so.filter((_, index) => index !== 1).map((m) => m.id), start: "19:02", end: "19:28", color: EVENT_COLORS[3],
      startReason: leftSo ? `תחילת אירוע: רכב ${leftSo} יצא/נותק מעבר ל־hold; הקבוצה המצומצמת אושרה.` : "תחילת אירוע: הרכב קבוצה חדש אושר.",
      endReason: "סיום אירוע: הגיע סוף טווח הזמן שנבחר לתחקור (19:28); לא זוהה שינוי מבני נוסף לפני הגבול.",
    },
  ];
}

function EventEvidenceMap({ serverId, events }: { serverId: string; events: EvidenceEvent[] }) {
  const scenario = getV09Scenario(serverId, 150);
  const drawings = events.map((event) => {
    const group = scenario.groups[event.group];
    const members = group.members.filter((member) => event.members.includes(member.id));
    const samples = members.flatMap((member) => {
      const route = scenario.routes.find((item) => item.key === member.routeKey) ?? scenario.routes[0];
      return Array.from({ length: 24 }, (_, index) => pointOnClosed(route.points, member.phase - index * .018));
    });
    const centroid = samples.length ? { x: samples.reduce((sum, point) => sum + point.x, 0) / samples.length, y: samples.reduce((sum, point) => sum + point.y, 0) / samples.length } : { x: 500, y: 285 };
    return { event, members, samples, centroid };
  });

  return <svg className="v10-event-evidence-map" viewBox="0 0 1000 570" role="img" aria-label="כל האירועים, הנתיבים והעקבות על מפה אחת">
    <defs><pattern id="v10-event-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" /></pattern></defs><rect width="1000" height="570" /><rect width="1000" height="570" fill="url(#v10-event-grid)" />
    {drawings.map(({ event, members, samples, centroid }) => <g key={event.id} className="v10-event-evidence">
      {members.map((member) => { const route = scenario.routes.find((item) => item.key === member.routeKey) ?? scenario.routes[0]; return <path key={`${event.id}-${member.routeKey}-${member.id}`} d={svgClosedPath(route.points)} fill="none" stroke={event.color} strokeWidth="5" opacity=".62" />; })}
      {samples.map((point, index) => <circle key={`${event.id}-trace-${index}`} cx={point.x} cy={point.y} r="4" fill={event.color} opacity={.28 + (index % 12) * .045} />)}
      <g transform={`translate(${centroid.x} ${centroid.y})`} className="v10-event-centroid"><circle r="22" fill={event.color} /><text y="5" textAnchor="middle">{event.id.split("-").at(-1)}</text></g>
    </g>)}
    <g className="v10-event-map-legend" transform="translate(30 30)">{events.map((event, index) => <g key={event.id} transform={`translate(0 ${index * 28})`}><circle cx="8" cy="0" r="7" fill={event.color} /><text x="22" y="4">{event.id.split("-").at(-1)} · {event.start}–{event.end}</text></g>)}</g>
  </svg>;
}

export function InvestigationViewV10({ server, onServerChange }: { server: string; onServerChange: (server: string) => void }) {
  const events = useMemo(() => evidenceEvents(server), [server]);
  return <div className="v10-investigation">
    <section className="v09-panel v10-all-events-panel"><div className="v09-panel-head"><div><p className="eyebrow">SRS v1.2 · ALL EVENTS</p><h2>כל האירועים על מפה אחת</h2><p>כל Event מקבל צבע משלו; כל הנתיבים והעקבות שלו באותו צבע והמזהה מוצג במרכז המסה.</p></div></div><EventEvidenceMap serverId={server} events={events} /></section>
    <section className="v09-panel v10-event-causes"><div className="v09-panel-head"><div><h2>סיבות התחלה וסיום · למפעיל</h2><p>מידע מפורט בעברית עם מזהה רכב וראיות מספריות.</p></div></div><div className="v10-cause-grid">{events.map((event) => <article key={event.id} style={{ borderInlineStartColor: event.color }}><header><i style={{ background: event.color }} /><b>{event.id.split("-").at(-1)}</b><span>{event.start}–{event.end}</span></header><div><strong>סיבת התחלה</strong><p>{event.startReason}</p></div><div><strong>סיבת סיום</strong><p>{event.endReason}</p></div></article>)}</div></section>
    <div className="v10-legacy-investigation"><InvestigationViewV09 server={server} onServerChange={onServerChange} /></div>
  </div>;
}
