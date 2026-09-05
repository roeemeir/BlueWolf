import type { SoRelation } from "@/lib/bluewolf";
import { doubleHippodromeLoop, hippodromeLoop, type Point } from "./geometry";

export type V09Vehicle = { id: number; typeId: string; phase: number; routeKey: string; ring?: "inner" | "middle" | "outer"; confidence: number };
export type V09Group = { key: "si" | "so"; id: string; name: string; family: "SI" | "SO"; members: V09Vehicle[]; observedAngles?: number[]; observedRelations?: SoRelation[]; routeScore: number; periodErrorPct: number; motionErrorPct: number; reason: string };
export type V09RouteShape = { key: string; kind: "circle" | "single" | "double"; points: Point[]; typeId: string };
export type V09Scenario = { id: string; title: string; subtitle: string; groups: { si: V09Group; so: V09Group }; routes: V09RouteShape[]; eventNote: string };

const TYPE_IDS = ["storm", "lightning", "thunder"];

function serverOne(tick: number): V09Scenario {
  const p = (tick * 0.0035) % 1;
  const siMembers: V09Vehicle[] = [
    { id: 101, typeId: TYPE_IDS[0], phase: p, routeKey: "si-a", ring: "outer", confidence: 98 },
    { id: 102, typeId: TYPE_IDS[1], phase: p + 1 / 3, routeKey: "si-b", ring: "middle", confidence: 97 },
    { id: 103, typeId: TYPE_IDS[2], phase: p + 2 / 3, routeKey: "si-c", ring: "outer", confidence: 96 },
  ];
  const soMembers: V09Vehicle[] = [
    { id: 111, typeId: TYPE_IDS[0], phase: p + 0.06, routeKey: "so-left", confidence: 94 },
    { id: 211, typeId: TYPE_IDS[1], phase: p + 0.55, routeKey: "so-double", confidence: 95 },
    { id: 112, typeId: TYPE_IDS[1], phase: p + 0.10, routeKey: "so-double", confidence: 93 },
    { id: 212, typeId: TYPE_IDS[2], phase: p + 0.62, routeKey: "so-right", confidence: 92 },
  ];
  return {
    id: "1", title: "Baseline · clean formations", subtitle: "SI 120° + SO single/double/single",
    groups: {
      si: { key: "si", id: "SI-01", name: "SI Alpha", family: "SI", members: siMembers, observedAngles: [120, 120], routeScore: 92, periodErrorPct: 2, motionErrorPct: 4, reason: "formation stable" },
      so: { key: "so", id: "SO-01", name: "SO Bravo", family: "SO", members: soMembers, observedRelations: ["opposite", "same"], routeScore: 86, periodErrorPct: 3, motionErrorPct: 6, reason: "minor far-turn lag" },
    },
    routes: [
      { key: "si-a", kind: "circle", points: hippodromeLoop({ x: 235, y: 285 }, 116, 0), typeId: TYPE_IDS[0] },
      { key: "si-b", kind: "circle", points: hippodromeLoop({ x: 235, y: 285 }, 82, 0), typeId: TYPE_IDS[1] },
      { key: "si-c", kind: "circle", points: hippodromeLoop({ x: 235, y: 285 }, 116, 0), typeId: TYPE_IDS[2] },
      { key: "so-left", kind: "single", points: hippodromeLoop({ x: 505, y: 360 }, 27, 118, -38), typeId: TYPE_IDS[0] },
      { key: "so-double", kind: "double", points: doubleHippodromeLoop({ x: 725, y: 275 }, 27, 92, 98, 28, -15), typeId: TYPE_IDS[1] },
      { key: "so-right", kind: "single", points: hippodromeLoop({ x: 916, y: 195 }, 25, 102, -51), typeId: TYPE_IDS[2] },
    ],
    eventNote: "clean baseline for visual/scoring regression",
  };
}

function serverTwo(tick: number): V09Scenario {
  const cycle = tick % 240;
  const p = (tick * 0.0042) % 1;
  const joined = cycle >= 70;
  const disconnected = cycle >= 145 && cycle < 180;
  const siMembers: V09Vehicle[] = [
    { id: 301, typeId: TYPE_IDS[0], phase: p, routeKey: "s2-si-a", ring: "outer", confidence: 93 },
    { id: 302, typeId: TYPE_IDS[0], phase: p + 0.5, routeKey: "s2-si-b", ring: "inner", confidence: 91 },
    ...(joined ? [{ id: 303, typeId: TYPE_IDS[2], phase: p + 0.25, routeKey: "s2-si-c", ring: "middle" as const, confidence: 89 }] : []),
  ];
  const soMembers: V09Vehicle[] = [
    { id: 321, typeId: TYPE_IDS[0], phase: p + 0.02, routeKey: "s2-so-a", confidence: 90 },
    ...(!disconnected ? [{ id: 421, typeId: TYPE_IDS[1], phase: p + 0.50, routeKey: "s2-so-b", confidence: 88 }] : []),
    { id: 521, typeId: TYPE_IDS[2], phase: p + 0.05, routeKey: "s2-so-c", confidence: 87 },
  ];
  return {
    id: "2", title: "Membership stress", subtitle: "join / leave / short disconnect / co-located SO",
    groups: {
      si: { key: "si", id: "SI-02", name: "SI Join Test", family: "SI", members: siMembers, observedAngles: joined ? [90, 90] : [180], routeScore: 84, periodErrorPct: 7, motionErrorPct: 9, reason: joined ? "new member under confirmation" : "two-member baseline" },
      so: { key: "so", id: "SO-02", name: "SO Co-located", family: "SO", members: soMembers, observedRelations: ["same", "opposite"], routeScore: disconnected ? 62 : 80, periodErrorPct: disconnected ? 16 : 8, motionErrorPct: 11, reason: disconnected ? "temporary data gap" : "co-located distinct routes" },
    },
    routes: [
      { key: "s2-si-a", kind: "circle", points: hippodromeLoop({ x: 230, y: 275 }, 108, 0), typeId: TYPE_IDS[0] },
      { key: "s2-si-b", kind: "circle", points: hippodromeLoop({ x: 230, y: 275 }, 58, 0), typeId: TYPE_IDS[0] },
      { key: "s2-si-c", kind: "circle", points: hippodromeLoop({ x: 230, y: 275 }, 82, 0), typeId: TYPE_IDS[2] },
      { key: "s2-so-a", kind: "single", points: hippodromeLoop({ x: 635, y: 310 }, 28, 150, -8), typeId: TYPE_IDS[0] },
      { key: "s2-so-b", kind: "single", points: hippodromeLoop({ x: 635, y: 310 }, 36, 150, -8), typeId: TYPE_IDS[1] },
      { key: "s2-so-c", kind: "single", points: hippodromeLoop({ x: 880, y: 240 }, 26, 120, 32), typeId: TYPE_IDS[2] },
    ],
    eventNote: disconnected ? "vehicle 421 temporarily disconnected; membership hold active" : joined ? "vehicle 303 joined; confirmation window running" : "pre-join baseline",
  };
}

function serverThree(tick: number): V09Scenario {
  const cycle = tick % 300;
  const p = (tick * (cycle > 130 ? 0.0052 : 0.0041)) % 1;
  const transition = cycle >= 190;
  const drift = cycle >= 110 ? 22 : 4;
  const siMembers: V09Vehicle[] = [
    { id: 601, typeId: TYPE_IDS[2], phase: p, routeKey: "s3-si-a", ring: "outer", confidence: 89 },
    { id: 602, typeId: TYPE_IDS[1], phase: p + 0.34, routeKey: "s3-si-b", ring: "middle", confidence: 88 },
    { id: 603, typeId: TYPE_IDS[0], phase: p + 0.69, routeKey: "s3-si-c", ring: "outer", confidence: 86 },
  ];
  const soMembers: V09Vehicle[] = transition ? [
    { id: 611, typeId: TYPE_IDS[0], phase: p, routeKey: "s3-transition-a", ring: "outer", confidence: 84 },
    { id: 612, typeId: TYPE_IDS[1], phase: p + 0.5, routeKey: "s3-transition-b", ring: "outer", confidence: 83 },
  ] : [
    { id: 611, typeId: TYPE_IDS[0], phase: p, routeKey: "s3-double", confidence: 86 },
    { id: 612, typeId: TYPE_IDS[1], phase: p + 0.5, routeKey: "s3-double", confidence: 85 },
    { id: 613, typeId: TYPE_IDS[2], phase: p + 0.24, routeKey: "s3-right", confidence: 82 },
  ];
  return {
    id: "3", title: "Route transition", subtitle: "+22% period drift · geometry revision · SO→SI",
    groups: {
      si: { key: "si", id: "SI-03", name: "SI Stress", family: "SI", members: siMembers, observedAngles: [122, 126], routeScore: 78, periodErrorPct: drift, motionErrorPct: 14, reason: drift >= 20 ? "material period change candidate" : "high-noise baseline" },
      so: { key: "so", id: "SO-03", name: transition ? "SO→SI Transition" : "SO Revision", family: "SO", members: soMembers, observedRelations: transition ? ["opposite"] : ["mixed", "opposite"], routeScore: transition ? 70 : 76, periodErrorPct: drift, motionErrorPct: 15, reason: transition ? "whole group changing route family" : "double route geometry revision" },
    },
    routes: transition ? [
      { key: "s3-si-a", kind: "circle", points: hippodromeLoop({ x: 250, y: 285 }, 118, 0), typeId: TYPE_IDS[2] },
      { key: "s3-si-b", kind: "circle", points: hippodromeLoop({ x: 250, y: 285 }, 82, 0), typeId: TYPE_IDS[1] },
      { key: "s3-si-c", kind: "circle", points: hippodromeLoop({ x: 250, y: 285 }, 118, 0), typeId: TYPE_IDS[0] },
      { key: "s3-transition-a", kind: "circle", points: hippodromeLoop({ x: 725, y: 270 }, 105, 0), typeId: TYPE_IDS[0] },
      { key: "s3-transition-b", kind: "circle", points: hippodromeLoop({ x: 725, y: 270 }, 82, 0), typeId: TYPE_IDS[1] },
    ] : [
      { key: "s3-si-a", kind: "circle", points: hippodromeLoop({ x: 250, y: 285 }, 118, 0), typeId: TYPE_IDS[2] },
      { key: "s3-si-b", kind: "circle", points: hippodromeLoop({ x: 250, y: 285 }, 82, 0), typeId: TYPE_IDS[1] },
      { key: "s3-si-c", kind: "circle", points: hippodromeLoop({ x: 250, y: 285 }, 118, 0), typeId: TYPE_IDS[0] },
      { key: "s3-double", kind: "double", points: doubleHippodromeLoop({ x: 700, y: 285 }, 30, 118, 106, 40, 8), typeId: TYPE_IDS[0] },
      { key: "s3-right", kind: "single", points: hippodromeLoop({ x: 930, y: 210 }, 24, 92, 56), typeId: TYPE_IDS[2] },
    ],
    eventNote: transition ? "SO→SI transition is intentionally visible" : drift >= 20 ? "+22% period change crosses the 20% revision gate" : "pre-change baseline",
  };
}

export function getV09Scenario(serverId: string, tick = 0): V09Scenario {
  if (serverId === "2") return serverTwo(tick);
  if (serverId === "3") return serverThree(tick);
  return serverOne(tick);
}

export type TimelinePoint = { minute: number; si: { total: number; sync: number; route: number }; so: { total: number; sync: number; route: number } };

export function v09ScoreSeries(serverId: string, minutes = 120): TimelinePoint[] {
  return Array.from({ length: minutes + 1 }, (_, minute) => {
    const server = Number(serverId) || 1;
    const stress = server === 2 ? (minute > 52 && minute < 74 ? 17 : 5) : server === 3 ? (minute > 58 ? 19 : 7) : 3;
    const siSync = 91 - stress * 0.35 + Math.sin(minute / 9 + server) * 5 + Math.sin(minute / 2.9) * 2;
    const siRoute = 88 - (server === 3 && minute > 60 ? 11 : 0) + Math.cos(minute / 11) * 4;
    const soSync = 85 - stress * 0.75 + Math.sin(minute / 8 + 1.4) * 7 + Math.sin(minute / 3.1) * 2;
    const soRoute = 84 - (server === 2 && minute > 50 && minute < 70 ? 14 : 0) + Math.cos(minute / 9 + 0.8) * 5;
    const norm = (v: number) => Math.max(15, Math.min(99, Math.round(v)));
    const si = { sync: norm(siSync), route: norm(siRoute), total: norm(siSync * 0.75 + siRoute * 0.25) };
    const so = { sync: norm(soSync), route: norm(soRoute), total: norm(soSync * 0.75 + soRoute * 0.25) };
    return { minute, si, so };
  });
}
