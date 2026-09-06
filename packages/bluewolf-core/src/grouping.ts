import { DEFAULT_SO_GROUPING, type SoGeometryDescriptor, type SoGroupingSettings } from "./contracts.ts";

export type SoGroupingEvidence = {
  valid: boolean;
  angleDiffDeg: number;
  parallelDistance: number;
  lateralDistance: number;
  meanLeg: number;
  parallelLegs: number;
  lateralLegs: number;
  axisDeg: number;
  explanation: string;
};

type Segment = { angleDeg: number; leg: number; turns: { x: number; y: number }[] };
const rad = (deg: number) => deg * Math.PI / 180;
const wrap180 = (value: number) => { const wrapped = ((value + 180) % 360 + 360) % 360 - 180; return wrapped === -180 ? 180 : wrapped; };
const axisAngleDiff = (a: number, b: number) => { const raw = Math.abs(wrap180(a - b)); return Math.min(raw, Math.abs(180 - raw)); };
const unit = (deg: number) => ({ x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) });
const add = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: { x: number; y: number }, value: number) => ({ x: a.x * value, y: a.y * value });

function averageAxisDeg(a: number, b: number) {
  const directedDiff = Math.abs(wrap180(b - a));
  const bAdjusted = directedDiff > 90 ? b + 180 : b;
  const ua = unit(a); const ub = unit(bAdjusted);
  return Math.atan2(ua.y + ub.y, ua.x + ub.x) * 180 / Math.PI;
}

function segments(geometry: SoGeometryDescriptor): Segment[] {
  const center = geometry.center;
  if (geometry.kind === "single" || geometry.kind === "figure8") {
    // Figure-8 is externally the same SO entity as a single hippodrome: two
    // end turns on one main axis. Its legs cross only inside the route.
    const leg = Math.max(1, geometry.legLength); const u = unit(geometry.rotationDeg);
    return [{ angleDeg: geometry.rotationDeg, leg, turns: [add(center, scale(u, -leg / 2)), add(center, scale(u, leg / 2))] }];
  }
  const firstLeg = Math.max(1, geometry.legLength); const secondLeg = Math.max(1, geometry.secondLegLength ?? geometry.legLength);
  const firstAxis = geometry.rotationDeg; const secondAxis = geometry.rotationDeg + (geometry.bendDeg ?? 28);
  const u1 = unit(firstAxis); const u2 = unit(secondAxis);
  return [
    { angleDeg: firstAxis, leg: firstLeg, turns: [center, add(center, scale(u1, -firstLeg))] },
    { angleDeg: secondAxis, leg: secondLeg, turns: [center, add(center, scale(u2, secondLeg))] },
  ];
}

export function soPairCompatibility(a: SoGeometryDescriptor, b: SoGeometryDescriptor, settings: SoGroupingSettings = DEFAULT_SO_GROUPING): SoGroupingEvidence {
  let best: SoGroupingEvidence | null = null; let bestCost = Infinity;
  for (const sa of segments(a)) for (const sb of segments(b)) {
    const angleDiffDeg = axisAngleDiff(sa.angleDeg, sb.angleDeg); const axisDeg = averageAxisDeg(sa.angleDeg, sb.angleDeg);
    const u = unit(axisDeg); const n = { x: -u.y, y: u.x }; const meanLeg = Math.max(1, (sa.leg + sb.leg) / 2);
    for (const ta of sa.turns) for (const tb of sb.turns) {
      const delta = { x: tb.x - ta.x, y: tb.y - ta.y };
      const parallelDistance = Math.abs(delta.x * u.x + delta.y * u.y); const lateralDistance = Math.abs(delta.x * n.x + delta.y * n.y);
      const parallelLegs = parallelDistance / meanLeg; const lateralLegs = lateralDistance / meanLeg;
      const valid = angleDiffDeg <= settings.maxAngleDeg && parallelLegs <= settings.maxParallelLegs && lateralLegs <= settings.maxLateralLegs;
      const cost = angleDiffDeg / Math.max(1, settings.maxAngleDeg) + parallelLegs / Math.max(.01, settings.maxParallelLegs) + lateralLegs / Math.max(.01, settings.maxLateralLegs);
      const candidate: SoGroupingEvidence = {
        valid, angleDiffDeg, parallelDistance, lateralDistance, meanLeg, parallelLegs, lateralLegs, axisDeg,
        explanation: valid
          ? `חוקיות תקינה: הפרש חזית ${angleDiffDeg.toFixed(1)}°, מרחק מקביל ${parallelLegs.toFixed(2)} Leg, מרחק רוחבי ${lateralLegs.toFixed(2)} Leg.`
          : `לא מקובץ: הפרש חזית ${angleDiffDeg.toFixed(1)}° (סף ${settings.maxAngleDeg}°), מקביל ${parallelLegs.toFixed(2)} Leg (סף ${settings.maxParallelLegs}), רוחבי ${lateralLegs.toFixed(2)} Leg (סף ${settings.maxLateralLegs}).`,
      };
      if (!best || (valid && !best.valid) || (valid === best.valid && cost < bestCost)) { best = candidate; bestCost = cost; }
    }
  }
  return best ?? { valid: false, angleDiffDeg: 180, parallelDistance: Infinity, lateralDistance: Infinity, meanLeg: 1, parallelLegs: Infinity, lateralLegs: Infinity, axisDeg: 0, explanation: "לא ניתן לחשב חוקיות גאומטרית." };
}

export function largestCompatibleComponent<T extends { geometry: SoGeometryDescriptor }>(routes: T[], settings: SoGroupingSettings = DEFAULT_SO_GROUPING) {
  if (routes.length <= 1) return { grouped: [...routes], ungrouped: [] as T[], pairEvidence: new Map<string, SoGroupingEvidence>() };
  const adjacency = routes.map(() => new Set<number>()); const pairEvidence = new Map<string, SoGroupingEvidence>();
  for (let i = 0; i < routes.length; i += 1) for (let j = i + 1; j < routes.length; j += 1) {
    const evidence = soPairCompatibility(routes[i].geometry, routes[j].geometry, settings); pairEvidence.set(`${i}:${j}`, evidence);
    if (evidence.valid) { adjacency[i].add(j); adjacency[j].add(i); }
  }
  const visited = new Set<number>(); const components: number[][] = [];
  for (let start = 0; start < routes.length; start += 1) {
    if (visited.has(start)) continue; const stack = [start]; const component: number[] = []; visited.add(start);
    while (stack.length) { const index = stack.pop()!; component.push(index); for (const neighbor of adjacency[index]) if (!visited.has(neighbor)) { visited.add(neighbor); stack.push(neighbor); } }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length || a[0] - b[0]); const groupedIndices = new Set(components[0] ?? []);
  return { grouped: routes.filter((_, index) => groupedIndices.has(index)), ungrouped: routes.filter((_, index) => !groupedIndices.has(index)), pairEvidence };
}
