import type { ScoreThresholds } from "./bluewolf";

export type ThresholdClassification = "product" | "calibration";
export type ThresholdVisualKind = "score-band" | "eligibility-gate" | "display-window" | "status-boundary";
export type ThresholdCatalogSelector = "full_score_through" | "zero_score_from" | null;

export type ThresholdExplainerDefinition = {
  classification: ThresholdClassification;
  catalogPath: string;
  catalogSelector: ThresholdCatalogSelector;
  catalogScale: number;
  visualKind: ThresholdVisualKind;
  aspect: string;
  effect: string;
  pair?: { full: keyof ScoreThresholds; zero: keyof ScoreThresholds };
};

const band = (
  catalogPath: string,
  aspect: string,
  effect: string,
  full: keyof ScoreThresholds,
  zero: keyof ScoreThresholds,
  catalogScale = 1,
): Pick<ThresholdExplainerDefinition, "classification" | "catalogPath" | "catalogScale" | "visualKind" | "aspect" | "effect" | "pair"> => ({
  classification: "product",
  catalogPath,
  catalogScale,
  visualKind: "score-band",
  aspect,
  effect,
  pair: { full, zero },
});

export const THRESHOLD_EXPLAINERS: Record<keyof ScoreThresholds, ThresholdExplainerDefinition> = {
  siPositionFullDeg: {
    ...band("core.scoring.si_position_deg", "שגיאת הזווית של הרכב מול מיקום ה-SI הרצוי.", "עד הסף הזה רכיב המיקום נשאר 100; לאחריו מתחילה ירידה ליניארית.", "siPositionFullDeg", "siPositionZeroDeg"),
    catalogSelector: "full_score_through",
  },
  siPositionZeroDeg: {
    ...band("core.scoring.si_position_deg", "שגיאת הזווית של הרכב מול מיקום ה-SI הרצוי.", "מהסף הזה רכיב המיקום הוא 0.", "siPositionFullDeg", "siPositionZeroDeg"),
    catalogSelector: "zero_score_from",
  },
  soPositionFullPct: {
    ...band("core.scoring.so_position_cycle", "שגיאת פאזה של הרכב לאורך הנתיב הלוגי ב-SO.", "עד הסף הזה רכיב המיקום נשאר 100; לאחריו מתחילה ירידה ליניארית.", "soPositionFullPct", "soPositionZeroPct", 100),
    catalogSelector: "full_score_through",
  },
  soPositionZeroPct: {
    ...band("core.scoring.so_position_cycle", "שגיאת פאזה של הרכב לאורך הנתיב הלוגי ב-SO.", "מהסף הזה רכיב המיקום הוא 0.", "soPositionFullPct", "soPositionZeroPct", 100),
    catalogSelector: "zero_score_from",
  },
  periodFullPct: {
    ...band("core.scoring.period_ratio", "פער יחסי בין מחזור הרכב למחזור הייחוס.", "עד הסף הזה רכיב המחזור נשאר 100; לאחריו הוא יורד ליניארית.", "periodFullPct", "periodZeroPct", 100),
    catalogSelector: "full_score_through",
  },
  periodZeroPct: {
    ...band("core.scoring.period_ratio", "פער יחסי בין מחזור הרכב למחזור הייחוס.", "מהסף הזה רכיב המחזור הוא 0.", "periodFullPct", "periodZeroPct", 100),
    catalogSelector: "zero_score_from",
  },
  motionFullPct: {
    ...band("core.scoring.movement_ratio", "פער בקצב ההתקדמות של הפאזה לעומת קצב הייחוס.", "עד הסף הזה רכיב התנועה נשאר 100; לאחריו הוא יורד ליניארית.", "motionFullPct", "motionZeroPct", 100),
    catalogSelector: "full_score_through",
  },
  motionZeroPct: {
    ...band("core.scoring.movement_ratio", "פער בקצב ההתקדמות של הפאזה לעומת קצב הייחוס.", "מהסף הזה רכיב התנועה הוא 0.", "motionFullPct", "motionZeroPct", 100),
    catalogSelector: "zero_score_from",
  },
  routeDistanceFullPct: {
    ...band("core.scoring.distance_short_axis_ratio", "המרחק הניצב מה-centerline, מנורמל ל-short axis.", "עד הסף הזה אין penalty לרכיב המרחק.", "routeDistanceFullPct", "routeDistanceZeroPct", 100),
    catalogSelector: "full_score_through",
  },
  routeDistanceZeroPct: {
    ...band("core.scoring.distance_short_axis_ratio", "המרחק הניצב מה-centerline, מנורמל ל-short axis.", "מהסף הזה רכיב המרחק הוא 0.", "routeDistanceFullPct", "routeDistanceZeroPct", 100),
    catalogSelector: "zero_score_from",
  },
  tangentFullDeg: {
    ...band("core.scoring.tangent_deg", "הזווית בין וקטור התנועה למשיק המקומי של הנתיב.", "עד הסף הזה רכיב המשיק נשאר 100.", "tangentFullDeg", "tangentZeroDeg"),
    catalogSelector: "full_score_through",
  },
  tangentZeroDeg: {
    ...band("core.scoring.tangent_deg", "הזווית בין וקטור התנועה למשיק המקומי של הנתיב.", "מהסף הזה רכיב המשיק הוא 0.", "tangentFullDeg", "tangentZeroDeg"),
    catalogSelector: "zero_score_from",
  },
  curvatureFullPct: {
    ...band("core.scoring.curvature_ratio", "פער העקמומיות המקומית ביחס לעקמומיות הצפויה במסלול.", "עד הסף הזה רכיב העקמומיות נשאר 100.", "curvatureFullPct", "curvatureZeroPct", 100),
    catalogSelector: "full_score_through",
  },
  curvatureZeroPct: {
    ...band("core.scoring.curvature_ratio", "פער העקמומיות המקומית ביחס לעקמומיות הצפויה במסלול.", "מהסף הזה רכיב העקמומיות הוא 0.", "curvatureFullPct", "curvatureZeroPct", 100),
    catalogSelector: "zero_score_from",
  },
  lowSpeedPct: {
    classification: "product",
    catalogPath: "core.scoring.minimum_motion_speed_fraction",
    catalogSelector: null,
    catalogScale: 100,
    visualKind: "eligibility-gate",
    aspect: "מהירות התנועה בפועל ביחס למהירות העבודה של סוג הרכב.",
    effect: "מתחת לסף הזה tangent, curvature וכיוון תנועה אינם observable ולכן לא מחושבים כאילו היו תקפים.",
  },
  smoothingSeconds: {
    classification: "product",
    catalogPath: "core.scoring.displayed_smoothing_seconds",
    catalogSelector: null,
    catalogScale: 1,
    visualKind: "display-window",
    aspect: "חלון הזמן של trailing smoothing לתצוגה.",
    effect: "משנה רק את הציון המוצג בגרף ובכרטיסים; raw Core score, alerts, events ו-grouping נשארים ללא שינוי.",
  },
  greenScore: {
    classification: "product",
    catalogPath: "core.scoring.good_score_from",
    catalogSelector: null,
    catalogScale: 1,
    visualKind: "status-boundary",
    aspect: "גבול התצוגה בין ביצוע בינוני לביצוע טוב.",
    effect: "מהערך הזה ומעלה התצוגה מסווגת את הציון כטוב/ירוק; הציון המספרי עצמו אינו משתנה.",
  },
  redScore: {
    classification: "product",
    catalogPath: "core.scoring.low_score_below",
    catalogSelector: null,
    catalogScale: 1,
    visualKind: "status-boundary",
    aspect: "גבול התצוגה וה-lifecycle לציון נמוך.",
    effect: "מתחת לערך הזה מתחיל low-score evidence; alert נפתח רק לאחר משך ההיסטרזיס המוגדר ולא בגלל צבע UI בלבד.",
  },
};

export function thresholdClassificationLabel(value: ThresholdClassification) {
  return value === "product" ? "חוק מוצר" : "סף כיול";
}
