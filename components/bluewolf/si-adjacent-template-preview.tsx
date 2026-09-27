"use client";

import { siAdjacentAngles } from "@/lib/si-adjacent-angles";
import { siAngularSeparation } from "@/lib/si-direct-placement";
import type { RingRole, SiPosition, VehicleType } from "@/lib/bluewolf";

const rings: Record<RingRole, number> = { inner: 36, middle: 57, outer: 78 };
const fallbackRings: RingRole[] = ["inner", "middle", "outer", "middle", "outer"];

function point(deg: number, radius: number) {
  const radians = (deg - 90) * Math.PI / 180;
  return { x: 200 + Math.cos(radians) * radius, y: 125 + Math.sin(radians) * radius };
}

function pairIndex(first: number, second: number, count: number) {
  return first * (2 * count - first - 1) / 2 + second - first - 1;
}

/** Old SI rows contain all-pair constraints without physical coordinates.
 * Reconstruct only if a formation genuinely satisfies EVERY saved pair. Never
 * invent coincident vehicles to render an impossible all-pairs 90° template.
 */
function reconstructLegacy(values: readonly number[]): SiPosition[] | null {
  const count = [2, 3, 4, 5].find((n) => n * (n - 1) / 2 === values.length);
  if (!count || values.some((angle) => !Number.isFinite(angle) || angle < 0 || angle > 180)) return null;
  const bearings = [0];
  const solve = (index: number): boolean => {
    if (index === count) return true;
    for (let angle = 0; angle < 360; angle += 15) {
      if (!bearings.every((previous, first) => siAngularSeparation(previous, angle) === values[pairIndex(first, index, count)])) continue;
      bearings.push(angle);
      if (solve(index + 1)) return true;
      bearings.pop();
    }
    return false;
  };
  if (!solve(1)) return null;
  return bearings.map((angleDeg, index) => ({ angleDeg, ring: fallbackRings[index], typeId: "" }));
}

export function SiAdjacentTemplatePreview({ values, siPositions, compact = false, title, vehicleTypes = [] }: {
  values: number[];
  siPositions?: SiPosition[];
  compact?: boolean;
  title?: string;
  vehicleTypes?: VehicleType[];
}) {
  const source = siPositions?.length ? siPositions : reconstructLegacy(values);
  const positions = source && source.every((slot) => Number.isFinite(slot.angleDeg) && slot.ring in rings) ? source : null;
  if (!positions) {
    return <div className="si-placement-preview" role="alert" data-testid="si-template-invalid-geometry" dir="rtl">
      <strong>אי־התאמה בין ערכי התבנית למיקומי הרכבים</strong>
      <p>לא ניתן לצייר את התבנית לפי ההפרשים השמורים. יש להגדיר מחדש מיקומי רכבים והפרשים בין סמוכים; לא יוצג ציור מטעה.</p>
    </div>;
  }
  const gaps = siAdjacentAngles(positions);
  const typeColorById = new Map(vehicleTypes.map((type) => [type.id, type.color]));
  const fallbackColors = ["#ff9f43", "#34b7eb", "#9068ff", "#d16ff2", "#4fbf79"];
  return <div className="si-placement-preview" dir="rtl" data-testid="si-adjacent-template-preview">
    <svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox="0 0 400 250" role="img" aria-label={title ?? "תצוגת תבנית SI: הפרשי זוויות בין רכבים סמוכים בלבד"}>
      <rect width="400" height="250" rx="20" />
      {(Object.keys(rings) as RingRole[]).map((ring) => <circle key={ring} cx="200" cy="125" r={rings[ring]} className={`ring ${ring}`} />)}
      {gaps.map((gap) => {
        const start = point(gap.startDeg, 93);
        const end = point(gap.endDeg, 93);
        const label = point(gap.startDeg + gap.angle / 2, 109);
        return <g key={`gap:${gap.first}:${gap.second}`} data-testid="si-adjacent-angle" aria-label={`הפרש בין רכבים סמוכים: ${gap.angle} מעלות`}>
          {gap.angle > 0 && <path d={`M${start.x},${start.y} A93,93 0 ${gap.angle > 180 ? 1 : 0} 1 ${end.x},${end.y}`} fill="none" stroke="var(--brand)" strokeWidth="2" />}
          <text x={label.x} y={label.y + 4} textAnchor="middle" stroke="var(--map-bg)" strokeWidth="3" paintOrder="stroke" fill="var(--text)" fontSize="12" fontWeight="800">{gap.angle}°</text>
        </g>;
      })}
      {positions.map((slot, index) => {
        const p = point(slot.angleDeg, rings[slot.ring]);
        const color = typeColorById.get(slot.typeId) ?? fallbackColors[index % fallbackColors.length];
        return <g key={`vehicle:${index}`} data-testid={`si-preview-vehicle-${index}`} aria-label={`רכב ${index + 1}`}>
          <circle cx={p.x} cy={p.y} r="9" fill={color} stroke="var(--map-card)" strokeWidth="1.5" />
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#122333">{index + 1}</text>
        </g>;
      })}
    </svg>
    {!compact && <div className="si-pair-summary" data-testid="si-preview-adjacent-summary"><strong>הפרשים בין רכבים סמוכים:</strong> <bdi>{gaps.map((gap) => `${gap.angle}°`).join(" · ")}</bdi>{!siPositions?.length && <small>מיקומי הטבעות משוחזרים לצורך המחשה מתוך יחסי הזוויות השמורים.</small>}</div>}
  </div>;
}
