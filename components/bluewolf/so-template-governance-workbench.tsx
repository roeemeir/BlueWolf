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
  placeSoVehicle,
  removeSoVehicle,
  toggleSoVehicleDirection,
  validateSoPlacements,
  type SoDirectPlacement,
} from "@/lib/so-direct-placement";
import { buildSoSmileGeometry, pointAtSoPhase, soPhasesForRoute } from "@/lib/so-geometry";
import { useWorkspace } from "./app-context";

type HoverSlot = { routeIndex: number; phase: number } | null;
type DirectSoSpecExtension = {
  directPlacements: SoDirectPlacement[];
  generatorCounts: { single: number; double: number };
};
type PersistedDirectSoSpec = NonNullable<SyncTemplate["soSpec"]> & DirectSoSpecExtension;

function chainLabel(chain: readonly SoRouteKind[]) {
  return chain.map((kind) => kind === "single" ? "יחיד" : "כפול").join(" — ");
}

function countByType(placements: readonly SoDirectPlacement[], chain: readonly SoRouteKind[], kind: SoRouteKind) {
  const result: Record<string, number> = {};
  for (const placement of placements) {
    if (chain[placement.routeIndex] !== kind) continue;
    result[placement.typeId] = (result[placement.typeId] ?? 0) + 1;
  }
  return result;
}

function placementKey(routeIndex: number, phase: number) {
  return `${routeIndex}:${phase}`;
}

export function SoTemplateGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const [singleCount, setSingleCount] = useState(2);
  const [doubleCount, setDoubleCount] = useState(1);
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);
  const [selectedTypeId, setSelectedTypeId] = useState(state.vehicleTypes[0]?.id ?? "");
  const [placements, setPlacements] = useState<SoDirectPlacement[]>([]);
  const [hoverSlot, setHoverSlot] = useState<HoverSlot>(null);
  const [name, setName] = useState("");

  const orders = useMemo(() => generateUniqueSoOrders(singleCount, doubleCount), [singleCount, doubleCount]);
  const chain = orders[Math.min(selectedOrderIndex, Math.max(0, orders.length - 1))] ?? [];
  const relations = deriveSoRelations(chain, placements);
  const selectedType = state.vehicleTypes.find((type) => type.id === selectedTypeId) ?? null;
  const typeById = useMemo(() => new Map(state.vehicleTypes.map((type) => [type.id, type])), [state.vehicleTypes]);
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
    if (singleCount + doubleCount + delta > 8) {
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
    if (!selectedType) {
      toast.error("בחר סוג רכב לפני הצבה");
      return;
    }
    const placed = placeSoVehicle(placements, chain, routeIndex, phase, selectedType.id);
    if (!placed.ok) {
      const messages = {
        "invalid-route": "מיקום SO מפנה להיפודרום שאינו קיים",
        "invalid-phase": "המיקום אינו חוקי לסוג ההיפודרום",
        "slot-occupied": "המיקום כבר תפוס",
        "vehicle-type-required": "יש לבחור סוג רכב",
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
      toast.error("יש להציב לפחות רכב אחד בתבנית SO");
      return;
    }
    const singleCounts = countByType(placements, chain, "single");
    const doubleCounts = countByType(placements, chain, "double");
    const extendedSpec: PersistedDirectSoSpec = {
      singleCounts,
      doubleCounts,
      chain: [...chain],
      relations,
      directPlacements: placements.map((item) => ({ ...item })),
      generatorCounts: { single: singleCount, double: doubleCount },
    };
    const template: SyncTemplate = {
      id: createId("tpl-so-direct"),
      family: "SO",
      name: name.trim() || `SO · ${chainLabel(chain)}`,
      mix: placements.map((item) => typeById.get(item.typeId)?.name ?? item.typeId).join(" · "),
      constellation: chainLabel(chain),
      law: "SO direct placement: Single halves / Double quarters; relations derived from semantic placement",
      values: relations.map(relationCode),
      soSpec: extendedSpec,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    };
    const candidateIdentity = directSoPlacementKey(chain, placements);
    const duplicate = state.templates.some((item) => {
      if (item.family !== "SO" || !item.soSpec) return false;
      const existing = item.soSpec as PersistedDirectSoSpec;
      if (!Array.isArray(existing.directPlacements)) return false;
      return directSoPlacementKey(existing.chain, existing.directPlacements) === candidateIdentity;
    });
    if (duplicate) {
      toast.warning("כבר קיימת תבנית SO עם אותו סדר ואותה הצבה ישירה");
      return;
    }
    const ok = await save({ ...state, templates: [...state.templates, template] }, "templates", "create-direct-so", template.name);
    if (ok) {
      setName("");
      setPlacements([]);
    }
  };

  return <section className="glass-panel" dir="rtl" data-requirements="SO-01 SO-02 GEO-01 GEO-02" data-testid="so-direct-workbench" style={{ padding: 18, marginBottom: 16 }}>
    <header className="developer-section-header" style={{ marginBottom: 16 }}>
      <div><p className="eyebrow">SO direct generator</p><h2>מחולל סדרים והצבה ישירה</h2><p>הכמויות מתייחסות להיפודרומים Single/Double בלבד. אחרי בחירת סדר, הרכב מוצב ישירות בחצי או ברבע; לחיצה על רכב קיים הופכת את כיוון התנועה. Same/Opposite/Mixed נגזרים מההצבה.</p></div>
      <Badge variant="outline">{orders.length} סדרים לא־שקולים</Badge>
    </header>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(220px,1fr)) minmax(240px,1.4fr)", gap: 12, alignItems: "end" }}>
      {(["single", "double"] as const).map((kind) => {
        const value = kind === "single" ? singleCount : doubleCount;
        return <div key={kind} data-testid={`so-count-${kind}`} style={{ border: "1px solid currentColor", borderRadius: 12, padding: 12 }}><span>{kind === "single" ? "Single" : "Double"}</span><div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}><Button size="icon-sm" variant="outline" aria-label={`הפחת ${kind}`} onClick={() => changeCounts(kind, -1)}><Minus /></Button><strong style={{ minWidth: 24, textAlign: "center" }}>{value}</strong><Button size="icon-sm" variant="outline" aria-label={`הוסף ${kind}`} onClick={() => changeCounts(kind, 1)}><Plus /></Button></div></div>;
      })}
      <label style={{ display: "grid", gap: 6 }}><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="SO · שם אופציונלי" /></label>
    </div>

    <div style={{ marginTop: 16 }}>
      <strong>כל הסדרים השונים · סדר והיפוכו מוצגים פעם אחת</strong>
      <div data-testid="so-generated-orders" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>{orders.map((order, index) => <button type="button" key={`${order.join("-")}-${index}`} onClick={() => selectOrder(index)} aria-pressed={index === selectedOrderIndex} style={{ border: index === selectedOrderIndex ? "2px solid currentColor" : "1px solid currentColor", borderRadius: 10, padding: "8px 10px", background: "transparent" }}>{chainLabel(order)}</button>)}</div>
    </div>

    <div data-testid="so-vehicle-palette" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
      {state.vehicleTypes.map((type) => <button type="button" key={type.id} onClick={() => setSelectedTypeId(type.id)} aria-pressed={selectedTypeId === type.id} style={{ border: selectedTypeId === type.id ? `2px solid ${type.color}` : "1px solid currentColor", borderRadius: 10, padding: "8px 10px", background: "transparent" }}><strong>{type.name}</strong><small style={{ display: "block" }}>סוג בלבד · המיקום אינו משתנה</small></button>)}
    </div>

    {chain.length ? <div style={{ marginTop: 16, overflowX: "auto" }}>
      <svg data-testid="so-direct-board" viewBox={`0 0 ${width} ${height}`} aria-label="SO smile direct placement board" style={{ width: "100%", minWidth: Math.min(width, 760), minHeight: 350, border: "1px solid currentColor", borderRadius: 16 }}>
        {geometry.map((route) => <g key={`${route.kind}-${route.routeIndex}`} data-testid={`so-route-${route.routeIndex}-${route.kind}`}>
          <path d={route.path} fill="none" stroke="currentColor" strokeWidth="3" />
          <text x={route.center.x} y={route.center.y - 58} textAnchor="middle" fill="currentColor" stroke="none" fontSize="12">{route.routeIndex + 1} · {route.kind === "single" ? "Single" : "Double"} · {route.rotationDeg}°</text>
          {soPhasesForRoute(route.kind).map((phase) => {
            const existing = placements.find((item) => item.routeIndex === route.routeIndex && item.phase === phase) ?? null;
            const type = existing ? typeById.get(existing.typeId) : selectedType;
            const hovered = hoverSlot?.routeIndex === route.routeIndex && hoverSlot.phase === phase;
            const point = pointAtSoPhase(route.points, phase, existing?.direction === "reverse");
            const radians = (point.heading - 90) * Math.PI / 180;
            const dx = Math.cos(radians) * 22;
            const dy = Math.sin(radians) * 22;
            return <g key={`${route.routeIndex}-${phase}`} data-testid={`so-slot-${route.routeIndex}-${phase}`} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`} onMouseEnter={() => !existing && setHoverSlot({ routeIndex: route.routeIndex, phase })} onMouseLeave={() => setHoverSlot(null)} onFocus={() => !existing && setHoverSlot({ routeIndex: route.routeIndex, phase })} onBlur={() => setHoverSlot(null)} onClick={() => clickSlot(route.routeIndex, phase)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); clickSlot(route.routeIndex, phase); } }} style={{ cursor: "pointer" }}>
              <circle r={existing ? 12 : 8} fill={existing ? (type?.color ?? "currentColor") : hovered ? (type?.color ?? "currentColor") : "transparent"} fillOpacity={existing ? 1 : hovered ? .25 : 0} stroke="currentColor" strokeWidth={existing ? 2.5 : 1.2} />
              {(existing || hovered) && <><line x1="0" y1="0" x2={dx} y2={dy} stroke={type?.color ?? "currentColor"} strokeWidth="2.5" strokeOpacity={existing ? 1 : .35} /><path d={`M${dx},${dy} l${-dx * .22 - dy * .14},${-dy * .22 + dx * .14} M${dx},${dy} l${-dx * .22 + dy * .14},${-dy * .22 - dx * .14}`} fill="none" stroke={type?.color ?? "currentColor"} strokeWidth="2" strokeOpacity={existing ? 1 : .35} /></>}
              {existing && <text x="0" y="4" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="700">{type?.name.slice(0,2)}</text>}
            </g>;
          })}
        </g>)}
      </svg>
      <p className="card-hint">ריחוף מציג רכב שקוף בלבד; placement מתבצע בקליק/מגע. לחיצה חוזרת על רכב קיים הופכת את הכיוון המשיק. Single, Double והמיקומים נגזרים מאותו מקור גאומטרי שמשמש את שאר תצוגות SO.</p>
    </div> : <div className="empty-state" style={{ marginTop: 18 }}>בחר לפחות Single או Double אחד.</div>}

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(260px,.6fr)", gap: 14, marginTop: 16 }}>
      <div><strong>רכבים שהוצבו</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{placements.length ? placements.map((placement) => <div key={placementKey(placement.routeIndex, placement.phase)} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", border: "1px solid currentColor", borderRadius: 9, padding: 8 }}><span>{typeById.get(placement.typeId)?.name ?? placement.typeId} · היפודרום {placement.routeIndex + 1} · phase {placement.phase} · {placement.direction}</span><Button size="icon-sm" variant="ghost" onClick={() => setPlacements(removeSoVehicle(placements, placement.routeIndex, placement.phase))} aria-label="הסר רכב"><Trash2 /></Button></div>) : <span className="card-hint">עדיין לא הוצבו רכבים.</span>}</div></div>
      <div><strong>יחסים נגזרים</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{relations.length ? relations.map((relation, index) => <Badge key={index} variant="outline">{index + 1}↔{index + 2}: {SO_RELATION_LABELS[relation]}</Badge>) : <span className="card-hint">אין שכנים להשוואה.</span>}</div></div>
    </div>

    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><Button onClick={saveTemplate} data-testid="so-direct-save"><Save />שמור תבנית SO</Button></div>
  </section>;
}
