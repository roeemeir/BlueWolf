"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SO_RELATION_LABELS,
  createId,
  relationCode,
  type SoRouteKind,
  type SyncTemplate,
} from "@/lib/bluewolf";
import {
  deriveSoRelations,
  directSoPlacementKey,
  generateUniqueSoOrders,
  placeSoPosition,
  removeSoVehicle,
  toggleSoVehicleDirection,
  validateSoPlacements,
  type SoDirectPlacement,
} from "@/lib/so-direct-placement";
import { buildSoSmileGeometry, pointAtSoPhase, soPhasesForRoute } from "@/lib/so-geometry";
import { useWorkspace } from "./app-context";

type HoverSlot = { routeIndex: number; phase: number } | null;
type DirectSoSpecExtension = {
  schemaVersion: "so-direct.v2";
  directPlacements: SoDirectPlacement[];
  generatorCounts: { single: number; double: number };
};
type PersistedDirectSoSpec = NonNullable<SyncTemplate["soSpec"]> & DirectSoSpecExtension;

function chainLabel(chain: readonly SoRouteKind[]) {
  return chain.map((kind) => kind === "single" ? "יחיד" : "כפול").join(" — ");
}

function placementKey(routeIndex: number, phase: number) {
  return `${routeIndex}:${phase}`;
}

function phaseLabel(kind: SoRouteKind, phase: number) {
  if (kind === "single") return phase === 0 ? "חצי A" : "חצי B";
  const quarter = Math.round(phase * 4) % 4;
  return `רבע ${quarter + 1}`;
}

export function SoTemplateGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const [singleCount, setSingleCount] = useState(2);
  const [doubleCount, setDoubleCount] = useState(1);
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);
  const [placements, setPlacements] = useState<SoDirectPlacement[]>([]);
  const [hoverSlot, setHoverSlot] = useState<HoverSlot>(null);
  const [name, setName] = useState("");

  const orders = useMemo(() => generateUniqueSoOrders(singleCount, doubleCount), [singleCount, doubleCount]);
  const chain = orders[Math.min(selectedOrderIndex, Math.max(0, orders.length - 1))] ?? [];
  const relations = deriveSoRelations(chain, placements);
  const width = Math.max(760, 300 + Math.max(0, chain.length - 1) * 185);
  const halfIndex = Math.max(0, (chain.length - 1) / 2);
  const height = Math.max(460, 330 + halfIndex * halfIndex * 22 + 135);
  const geometry = useMemo(
    () => buildSoSmileGeometry(chain, {
      centerX: width / 2,
      centerY: 175,
      spacing: 170,
      risePerStep: 22,
      radius: 22,
      singleHalfLeg: 54,
      doubleHalfLeg: 104,
    }),
    [chain, width],
  );

  const changeCounts = (kind: SoRouteKind, delta: number) => {
    const current = kind === "single" ? singleCount : doubleCount;
    const next = Math.max(0, Math.min(6, current + delta));
    const nextTotal = (kind === "single" ? next : singleCount) + (kind === "double" ? next : doubleCount);
    if (nextTotal > 8) {
      toast.error("מחולל SO מוגבל ל־8 היפודרומים בתבנית");
      return;
    }
    if (kind === "single") setSingleCount(next); else setDoubleCount(next);
    setSelectedOrderIndex(0);
    setPlacements([]);
    setHoverSlot(null);
  };

  const selectOrder = (index: number) => {
    setSelectedOrderIndex(index);
    setPlacements([]);
    setHoverSlot(null);
  };

  const clickSlot = (routeIndex: number, phase: number) => {
    const existing = placements.find((item) => item.routeIndex === routeIndex && item.phase === phase);
    if (existing) {
      setPlacements(toggleSoVehicleDirection(placements, routeIndex, phase));
      return;
    }
    const placed = placeSoPosition(placements, chain, routeIndex, phase);
    if (!placed.ok) {
      const messages = {
        "invalid-route": "מיקום SO מפנה להיפודרום שאינו קיים",
        "invalid-phase": "המיקום אינו חוקי לסוג ההיפודרום",
        "slot-occupied": "המיקום כבר תפוס",
      } as const;
      toast.error(messages[placed.reason]);
      return;
    }
    setPlacements(placed.placements);
  };

  const saveTemplate = async () => {
    if (!chain.length) {
      toast.error("יש לבחור לפחות היפודרום אחד");
      return;
    }
    const validation = validateSoPlacements(chain, placements);
    if (validation) {
      toast.error(validation);
      return;
    }
    if (!placements.length) {
      toast.error("יש להציב לפחות מיקום אחד בתבנית SO");
      return;
    }

    // singleCounts/doubleCounts stay empty for backward schema compatibility only.
    // New SO templates are defined by chain + directPlacements, never by vehicle type.
    const extendedSpec: PersistedDirectSoSpec = {
      singleCounts: {},
      doubleCounts: {},
      chain: [...chain],
      relations,
      schemaVersion: "so-direct.v2",
      directPlacements: placements.map(({ routeIndex, phase, direction }) => ({ routeIndex, phase, direction })),
      generatorCounts: { single: singleCount, double: doubleCount },
    };
    const template: SyncTemplate = {
      id: createId("tpl-so-direct"),
      family: "SO",
      name: name.trim() || `SO · ${chainLabel(chain)}`,
      mix: `${placements.length} מיקומים · ללא תלות בסוג רכב`,
      constellation: chainLabel(chain),
      law: "SO direct placement v2: Single halves / Double quarters; vehicle type is an operational binding; relations are derived from semantic placement",
      values: relations.map(relationCode),
      soSpec: extendedSpec,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    };
    const candidateIdentity = directSoPlacementKey(chain, placements);
    const duplicate = state.templates.some((item) => {
      if (item.family !== "SO" || !item.soSpec) return false;
      const existing = item.soSpec as Partial<PersistedDirectSoSpec>;
      if (!Array.isArray(existing.directPlacements)) return false;
      return directSoPlacementKey(existing.chain ?? [], existing.directPlacements) === candidateIdentity;
    });
    if (duplicate) {
      toast.warning("כבר קיימת תבנית SO עם אותו סדר ואותה הצבה ישירה");
      return;
    }
    const ok = await save({ ...state, templates: [...state.templates, template] }, "templates", "create-direct-so-v2", template.name);
    if (ok) {
      setName("");
      setPlacements([]);
      setHoverSlot(null);
    }
  };

  return <section className="glass-panel so-neutral-editor" dir="rtl" data-requirements="SO-01 SO-02 GEO-01 GEO-02" data-testid="so-direct-workbench">
    <style>{`
      .so-neutral-editor{padding:18px;margin-bottom:16px;border-radius:18px}.so-generator-grid{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr)) minmax(220px,1.3fr);gap:12px;align-items:end}.so-counter{border:1px solid var(--line);border-radius:12px;padding:12px}.so-counter-row{display:flex;align-items:center;gap:10px;margin-top:8px}.so-name{display:grid;gap:6px}.so-name input{height:38px;border:1px solid var(--input);border-radius:10px;padding:0 10px;background:var(--surface-soft);color:inherit}.so-orders{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.so-orders button{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface-soft);color:inherit}.so-orders button[aria-pressed="true"]{border:2px solid var(--brand)}.so-board-wrap{margin-top:16px;overflow-x:auto}.so-board{width:100%;min-height:350px;border:1px solid var(--line);border-radius:16px;background:radial-gradient(circle at center,color-mix(in srgb,var(--brand) 6%,transparent),transparent 72%),var(--map-bg)}.so-summary-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.6fr);gap:14px;margin-top:16px}.so-placement-list{display:grid;gap:6px;margin-top:8px}.so-placement-row{display:flex;justify-content:space-between;gap:8px;align-items:center;border:1px solid var(--line);border-radius:9px;padding:8px;background:var(--surface-soft)}.so-relations{display:grid;gap:6px;margin-top:8px}.so-neutral-note{margin:12px 0 0;color:var(--text-soft);font-size:11px}.so-save-row{display:flex;justify-content:flex-end;margin-top:16px}@media(max-width:760px){.so-neutral-editor{padding:13px}.so-generator-grid{grid-template-columns:1fr 1fr}.so-name{grid-column:1/-1}.so-summary-grid{grid-template-columns:1fr}.so-board{min-width:720px}.so-save-row button{width:100%}}
    `}</style>
    <header className="developer-section-header" style={{ marginBottom: 16 }}>
      <div><p className="eyebrow">SO direct generator</p><h2>מחולל שרשרת והצבה ישירה</h2><p>בוחרים רק כמה Single וכמה Double. המערכת מציעה את כל הסדרים הלא־שקולים תחת היפוך השרשרת. לאחר בחירת סדר, ממקמים משתתפים אנונימיים בחצי/רבע; סוג הרכב אינו חלק מתבנית SO.</p></div>
      <Badge variant="outline">{orders.length} סדרים לא־שקולים</Badge>
    </header>

    <div className="so-generator-grid">
      {(["single", "double"] as const).map((kind) => {
        const value = kind === "single" ? singleCount : doubleCount;
        return <div key={kind} data-testid={`so-count-${kind}`} className="so-counter"><span>{kind === "single" ? "Single" : "Double"}</span><div className="so-counter-row"><Button size="icon-sm" variant="outline" aria-label={`הפחת ${kind}`} onClick={() => changeCounts(kind, -1)}><Minus /></Button><strong style={{ minWidth: 24, textAlign: "center" }}>{value}</strong><Button size="icon-sm" variant="outline" aria-label={`הוסף ${kind}`} onClick={() => changeCounts(kind, 1)}><Plus /></Button></div></div>;
      })}
      <label className="so-name"><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="SO · שם אופציונלי" /></label>
    </div>

    <div style={{ marginTop: 16 }}>
      <strong>הצעות אוטומטיות · סדר והיפוכו מוצגים פעם אחת</strong>
      <div data-testid="so-generated-orders" className="so-orders">{orders.map((order, index) => <button type="button" key={`${order.join("-")}-${index}`} onClick={() => selectOrder(index)} aria-pressed={index === selectedOrderIndex}>{chainLabel(order)}</button>)}</div>
    </div>

    {chain.length ? <div className="so-board-wrap">
      <svg data-testid="so-direct-board" viewBox={`0 0 ${width} ${height}`} aria-label="SO type-neutral direct placement board" className="so-board">
        {geometry.map((route) => <g key={`${route.kind}-${route.routeIndex}`} data-testid={`so-route-${route.routeIndex}-${route.kind}`}>
          <path d={route.path} fill="none" stroke="currentColor" strokeWidth="3" />
          <text x={route.center.x} y={route.center.y - 58} textAnchor="middle" fill="currentColor" stroke="none" fontSize="12">{route.routeIndex + 1} · {route.kind === "single" ? "Single" : "Double"} · {route.rotationDeg}°</text>
          {soPhasesForRoute(route.kind).map((phase) => {
            const existing = placements.find((item) => item.routeIndex === route.routeIndex && item.phase === phase) ?? null;
            const hovered = hoverSlot?.routeIndex === route.routeIndex && hoverSlot.phase === phase;
            const point = pointAtSoPhase(route.points, phase, existing?.direction === "reverse");
            const radians = (point.heading - 90) * Math.PI / 180;
            const dx = Math.cos(radians) * 22;
            const dy = Math.sin(radians) * 22;
            const placementNumber = existing ? placements.findIndex((item) => item.routeIndex === route.routeIndex && item.phase === phase) + 1 : null;
            return <g key={`${route.routeIndex}-${phase}`} data-testid={`so-slot-${route.routeIndex}-${phase}`} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`} onMouseEnter={() => !existing && setHoverSlot({ routeIndex: route.routeIndex, phase })} onMouseLeave={() => setHoverSlot(null)} onFocus={() => !existing && setHoverSlot({ routeIndex: route.routeIndex, phase })} onBlur={() => setHoverSlot(null)} onClick={() => clickSlot(route.routeIndex, phase)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); clickSlot(route.routeIndex, phase); } }} style={{ cursor: "pointer" }}>
              <circle r={existing ? 13 : 9} fill={existing ? "var(--brand)" : hovered ? "var(--brand)" : "transparent"} fillOpacity={existing ? .9 : hovered ? .24 : 0} stroke={existing || hovered ? "var(--brand)" : "currentColor"} strokeWidth={existing ? 2.5 : 1.2} strokeDasharray={!existing && hovered ? "4 3" : undefined} />
              {(existing || hovered) && <><line x1="0" y1="0" x2={dx} y2={dy} stroke="var(--brand)" strokeWidth="2.5" strokeOpacity={existing ? 1 : .38} /><path d={`M${dx},${dy} l${-dx * .22 - dy * .14},${-dy * .22 + dx * .14} M${dx},${dy} l${-dx * .22 + dy * .14},${-dy * .22 - dx * .14}`} fill="none" stroke="var(--brand)" strokeWidth="2" strokeOpacity={existing ? 1 : .38} /></>}
              {existing && <text x="0" y="4" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" fontWeight="800">{placementNumber}</text>}
              {hovered && !existing && <text x="0" y="-17" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9">{phaseLabel(route.kind, phase)}</text>}
            </g>;
          })}
        </g>)}
      </svg>
      <p className="so-neutral-note">ריחוף מציג placement שקוף בלבד; קליק יוצר מיקום אנונימי. קליק נוסף על מיקום קיים הופך את הכיוון המשיק. שיוך סוגי רכב מתבצע מאוחר יותר ב־runtime/vehicle bindings ואינו משנה את חוק התבנית.</p>
    </div> : <div className="empty-state" style={{ marginTop: 18 }}>בחר לפחות Single או Double אחד.</div>}

    <div className="so-summary-grid">
      <div><strong>מיקומים שהוצבו</strong><div className="so-placement-list">{placements.length ? placements.map((placement, index) => <div key={placementKey(placement.routeIndex, placement.phase)} className="so-placement-row"><span>מיקום {index + 1} · היפודרום {placement.routeIndex + 1} · {phaseLabel(chain[placement.routeIndex], placement.phase)} · {placement.direction === "forward" ? "קדימה" : "הפוך"}</span><Button size="icon-sm" variant="ghost" onClick={() => setPlacements(removeSoVehicle(placements, placement.routeIndex, placement.phase))} aria-label="הסר מיקום"><Trash2 /></Button></div>) : <span className="card-hint">עדיין לא הוצבו מיקומים.</span>}</div></div>
      <div><strong>יחסים נגזרים אוטומטית</strong><div className="so-relations">{relations.length ? relations.map((relation, index) => <Badge key={index} variant="outline">{index + 1}↔{index + 2}: {SO_RELATION_LABELS[relation]}</Badge>) : <span className="card-hint">אין שכנים להשוואה.</span>}</div></div>
    </div>

    <div className="so-save-row"><Button onClick={saveTemplate} data-testid="so-direct-save"><Save />שמור תבנית SO</Button></div>
  </section>;
}
