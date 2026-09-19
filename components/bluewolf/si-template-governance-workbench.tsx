"use client";

import { useMemo, useRef, useState } from "react";
import { Crosshair, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canonicalTemplateKey, createId, type RingRole, type SiPosition, type SyncTemplate, type VehicleType } from "@/lib/bluewolf";
import { deriveSiPairRules, describeSiMix, placeSiVehicle, removeSiVehicle, validateSiPositions } from "@/lib/si-direct-placement";
import { useWorkspace } from "./app-context";

const CENTER = 250;
const RINGS: { id: RingRole; label: string; radius: number }[] = [
  { id: "inner", label: "פנימית", radius: 86 },
  { id: "middle", label: "ביניים", radius: 142 },
  { id: "outer", label: "חיצונית", radius: 198 },
];
const ANGLES = Array.from({ length: 12 }, (_, index) => index * 30);

type HoverTarget = { ring: RingRole; angleDeg: number; x: number; y: number } | null;

function ringLabel(ring: RingRole) {
  return RINGS.find((item) => item.id === ring)?.label ?? ring;
}

function polar(angleDeg: number, radius: number) {
  const radians = (angleDeg - 90) * Math.PI / 180;
  return { x: CENTER + Math.cos(radians) * radius, y: CENTER + Math.sin(radians) * radius };
}

function pointerToBoard(svg: SVGSVGElement, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (clientX - rect.left) / rect.width * 500,
    y: (clientY - rect.top) / rect.height * 500,
  };
}

function snapAngle(x: number, y: number) {
  const raw = (Math.atan2(y - CENTER, x - CENTER) * 180 / Math.PI + 90 + 360) % 360;
  return Math.round(raw / 30) * 30 % 360;
}

function nearestAllowedRing(x: number, y: number, type: VehicleType | null) {
  if (!type) return null;
  const radius = Math.hypot(x - CENTER, y - CENTER);
  const allowed = RINGS.filter((ring) => type.siRoles.includes(ring.id));
  if (!allowed.length) return null;
  return [...allowed].sort((a, b) => Math.abs(a.radius - radius) - Math.abs(b.radius - radius))[0];
}

export function SiTemplateGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const boardRef = useRef<SVGSVGElement>(null);
  const [name, setName] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState(state.vehicleTypes[0]?.id ?? "");
  const [positions, setPositions] = useState<SiPosition[]>([]);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null);

  const selectedType = state.vehicleTypes.find((type) => type.id === selectedTypeId) ?? null;
  const typeById = useMemo(() => new Map(state.vehicleTypes.map((type) => [type.id, type])), [state.vehicleTypes]);
  const pairRules = deriveSiPairRules(positions);

  const targetFromPointer = (clientX: number, clientY: number): HoverTarget => {
    const svg = boardRef.current;
    if (!svg || !selectedType) return null;
    const point = pointerToBoard(svg, clientX, clientY);
    if (!point) return null;
    const ring = nearestAllowedRing(point.x, point.y, selectedType);
    if (!ring) return null;
    const angleDeg = snapAngle(point.x, point.y);
    const snapped = polar(angleDeg, ring.radius);
    const occupied = positions.some((position) => position.ring === ring.id && position.angleDeg === angleDeg);
    return occupied ? null : { ring: ring.id, angleDeg, ...snapped };
  };

  const updateHover = (clientX: number, clientY: number) => {
    setHoverTarget(targetFromPointer(clientX, clientY));
  };

  const placeTarget = (target: HoverTarget) => {
    if (!target || !selectedType) return;
    const result = placeSiVehicle(positions, selectedType, target.ring, target.angleDeg);
    if (!result.ok) {
      const messages = {
        "invalid-angle": "מיקום SI חייב להינעל לכפולות של 30°",
        "ring-not-allowed": `${selectedType.name} אינו מורשה בטבעת ${ringLabel(target.ring)}`,
        "slot-occupied": "המיקום כבר תפוס",
        "max-vehicles": "SI תומך בעד 5 רכבים בתבנית",
      } as const;
      toast.error(messages[result.reason]);
      return;
    }
    setPositions(result.positions);
  };

  const removePosition = (index: number) => setPositions(removeSiVehicle(positions, index));

  const saveTemplate = async () => {
    const validation = validateSiPositions(positions, state.vehicleTypes);
    if (validation) { toast.error(validation); return; }
    if (!positions.length) { toast.error("יש להציב לפחות רכב אחד בתבנית SI"); return; }
    const template: SyncTemplate = {
      id: createId("tpl-si-direct"),
      family: "SI",
      name: name.trim() || `SI · ${positions.length} רכבים`,
      mix: describeSiMix(positions, state.vehicleTypes),
      constellation: positions.map((position) => `${typeById.get(position.typeId)?.name ?? position.typeId}@${ringLabel(position.ring)}:${position.angleDeg}°`).join(" — "),
      law: "SI coordinate placement snapped to legal 30° positions; siPositions is the source of truth",
      values: pairRules.map((rule) => rule.angle),
      siPairs: pairRules,
      siPositions: positions.map((position) => ({ ...position })),
      isDefault: false,
      updatedAt: new Date().toISOString(),
    };
    if (state.templates.some((item) => canonicalTemplateKey(item) === canonicalTemplateKey(template))) {
      toast.warning("כבר קיימת תבנית SI שקולה בסיבוב/מראה");
      return;
    }
    const ok = await save({ ...state, templates: [...state.templates, template] }, "templates", "create-coordinate-si", template.name);
    if (ok) { setName(""); setPositions([]); setHoverTarget(null); }
  };

  return <section className="glass-panel si-coordinate-editor" dir="rtl" data-requirements="SI-01 BW-SYNC-001 BW-SYNC-002" data-testid="si-coordinate-workbench">
    <style>{`
      .si-coordinate-editor{padding:18px;border-radius:18px;margin-bottom:16px}.si-editor-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.si-editor-head h2{margin:0}.si-editor-head p{margin:5px 0 0;color:var(--text-soft);font-size:12px;max-width:760px}
      .si-editor-grid{display:grid;grid-template-columns:minmax(340px,1.25fr) minmax(250px,.75fr);gap:18px}.si-palette{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.si-palette button{padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft);color:inherit}.si-palette button[aria-pressed="true"]{border-color:var(--brand);box-shadow:0 0 0 2px color-mix(in srgb,var(--brand) 15%,transparent)}
      .si-coordinate-board{display:block;width:100%;max-width:620px;aspect-ratio:1;border:1px solid var(--line);border-radius:18px;background:radial-gradient(circle at center,color-mix(in srgb,var(--brand) 7%,transparent),transparent 68%),var(--map-bg);touch-action:none;cursor:crosshair}.si-editor-side{display:grid;align-content:start;gap:12px}.si-editor-side label{display:grid;gap:5px}.si-editor-side input{height:38px;border:1px solid var(--input);border-radius:10px;background:var(--surface-soft);color:inherit;padding:0 10px}.si-position-list{display:grid;gap:6px}.si-position-list button{display:grid;grid-template-columns:1fr auto;gap:8px;text-align:right;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft);color:inherit}.si-pair-list{display:flex;gap:6px;flex-wrap:wrap}.si-pair-list span{padding:5px 7px;border-radius:999px;background:var(--surface-soft);font-size:11px}.si-ghost-help{display:flex;align-items:center;gap:7px;color:var(--text-soft);font-size:11px}
      @media(max-width:760px){.si-coordinate-editor{padding:13px}.si-editor-head{display:grid}.si-editor-grid{grid-template-columns:1fr}.si-coordinate-board{max-width:none}.si-editor-side{order:-1}.si-palette{overflow-x:auto;flex-wrap:nowrap}.si-palette button{min-width:max-content}}
    `}</style>
    <header className="si-editor-head"><div><p className="eyebrow">SI coordinate editor</p><h2>הצבה ישירה לפי מיקום העכבר</h2><p>בעכבר מתקבל ghost לפני ההצבה; בטלפון נוגעים ישירות בנקודה. בשני המצבים המיקום ננעל לטבעת חוקית ולזווית 30° הקרובה.</p></div><Badge variant="outline">{positions.length}/5 רכבים</Badge></header>
    <div className="si-editor-grid">
      <div>
        <div className="si-palette" data-testid="si-coordinate-palette">{state.vehicleTypes.map((type) => <button type="button" key={type.id} aria-pressed={selectedTypeId === type.id} onClick={() => { setSelectedTypeId(type.id); setHoverTarget(null); }}><strong>{type.name}</strong><small style={{ display: "block" }}>{type.siRoles.map(ringLabel).join(" / ") || "ללא טבעת"}</small></button>)}</div>
        <svg ref={boardRef} data-testid="si-coordinate-board" className="si-coordinate-board" viewBox="0 0 500 500" aria-label="SI coordinate based direct placement board" onPointerMove={(event) => { if (event.pointerType !== "touch") updateHover(event.clientX, event.clientY); }} onPointerLeave={() => setHoverTarget(null)} onPointerDown={(event) => { const target = targetFromPointer(event.clientX, event.clientY); if (!target) return; event.preventDefault(); placeTarget(target); }}>
          <circle cx={CENTER} cy={CENTER} r="5" fill="currentColor" opacity=".5" />
          {RINGS.map((ring) => <g key={ring.id}><circle cx={CENTER} cy={CENTER} r={ring.radius} fill="none" stroke="currentColor" strokeWidth="2" opacity=".24" /><text x={CENTER} y={CENTER - ring.radius + 14} textAnchor="middle" fill="currentColor" opacity=".55" fontSize="11">{ring.label}</text>{ANGLES.map((angle) => { const p = polar(angle, ring.radius); return <circle key={`${ring.id}-${angle}`} cx={p.x} cy={p.y} r="3.4" fill="currentColor" opacity=".2" />; })}</g>)}
          {positions.map((position, index) => { const ring = RINGS.find((item) => item.id === position.ring)!; const p = polar(position.angleDeg, ring.radius); const type = typeById.get(position.typeId); return <g key={`${position.typeId}-${position.ring}-${position.angleDeg}`} data-testid={`si-position-${index}`} onClick={(event) => { event.stopPropagation(); removePosition(index); }} style={{ cursor: "pointer" }}><circle cx={p.x} cy={p.y} r="14" fill={type?.color ?? "currentColor"} stroke="currentColor" strokeWidth="2.5" /><text x={p.x} y={p.y + 3} textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="800">{type?.name.slice(0, 2) ?? "V"}</text></g>; })}
          {hoverTarget && selectedType && <g data-testid="si-coordinate-ghost" pointerEvents="none"><circle cx={hoverTarget.x} cy={hoverTarget.y} r="15" fill={selectedType.color} opacity=".24" stroke={selectedType.color} strokeWidth="2.5" strokeDasharray="4 3" /><circle cx={hoverTarget.x} cy={hoverTarget.y} r="3" fill={selectedType.color} opacity=".7" /><text x={hoverTarget.x} y={hoverTarget.y - 20} textAnchor="middle" fill="currentColor" fontSize="10">{hoverTarget.angleDeg}° · {ringLabel(hoverTarget.ring)}</text></g>}
        </svg>
        <p className="si-ghost-help"><Crosshair />בעכבר ה־ghost הוא preview בלבד והלחיצה שומרת. במגע נגיעה ישירה שומרת; לחיצה על רכב קיים מסירה אותו.</p>
      </div>
      <aside className="si-editor-side">
        <label><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="SI · שם אופציונלי" /></label>
        <div><strong>מיקומים</strong><div className="si-position-list">{positions.length ? positions.map((position, index) => <button type="button" key={`${position.typeId}-${position.ring}-${position.angleDeg}`} onClick={() => removePosition(index)}><span>{typeById.get(position.typeId)?.name ?? position.typeId}</span><span>{ringLabel(position.ring)} · {position.angleDeg}° · הסר</span></button>) : <span className="card-hint">טרם הוצבו רכבים.</span>}</div></div>
        <div><strong>יחסים נגזרים</strong><div className="si-pair-list">{pairRules.length ? pairRules.map((rule) => <span key={`${rule.first}-${rule.second}`}>{rule.first + 1}↔{rule.second + 1}: {rule.angle}°</span>) : <span className="card-hint">היחסים ייגזרו אוטומטית מהמיקומים.</span>}</div></div>
        <Button onClick={saveTemplate}><Save />שמור תבנית SI</Button>
        <Button variant="outline" disabled={!positions.length} onClick={() => { setPositions([]); setHoverTarget(null); }}><Trash2 />נקה מיקומים</Button>
      </aside>
    </div>
  </section>;
}
