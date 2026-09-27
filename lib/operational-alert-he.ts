/**
 * Presentation-only Hebrew wording for alerts from the current runtime snapshot.
 * This module NEVER changes event identity, severity, scoring or Core evidence.
 * Unknown text is not guessed into a specific failure: the raw payload remains
 * available for diagnosis while the operator gets an explicit verification task.
 */
export type OperatorAlertWording = {
  title: string;
  detail: string;
  /** Unmodified source text for audit/support; not a substitute for a Hebrew UI. */
  sourceTitle: string;
  sourceDetail: string;
  recognized: boolean;
};

type Rule = { pattern: RegExp; title: string; guidance: string };

const RULES: readonly Rule[] = [
  {
    pattern: /(?:route[\s_-]*(?:deviation|departure|distance|error)|off[\s_-]*route|cross[\s_-]*track|סטייה\s*מהנתיב|חרג\s*מה(?:נתיב|מסלול)|מרחק\s*מהנתיב)/i,
    title: "סטייה מהנתיב",
    guidance: "בדקו במפה את עקבת הרכב מול הנתיב המזוהה, ואת מיקום היציאה והחזרה אליו.",
  },
  {
    pattern: /(?:turn[\s_-]*(?:timing|delay|late)|late[\s_-]*turn|delayed[\s_-]*turn|איחור\s*בפנייה|מאחר\s*בפנייה|תזמון\s*פנייה)/i,
    title: "אי־התאמה בתזמון הפנייה",
    guidance: "בדקו את זמני ההגעה של הרכבים לפנייה ואת כיוון ההתקדמות; השוו בין חברי הקבוצה.",
  },
  {
    pattern: /(?:heading|tangent|direction[\s_-]*mismatch|כיוון\s*תנועה|סטיית\s*כיוון|כיוון\s*משיק)/i,
    title: "אי־התאמה בכיוון התנועה",
    guidance: "בדקו במפה את כיוון התקדמות הרכב מול המשיק לנתיב ואת תקינות נתוני המהירות.",
  },
  {
    pattern: /(?:period[\s_-]*(?:mismatch|drift|error|difference)|cycle[\s_-]*(?:time|mismatch|drift)|זמן\s*מחזור|פער\s*במחזור|שינוי\s*מחזור)/i,
    title: "פער בזמן המחזור",
    guidance: "בדקו את זמן המחזור בפועל של כל רכב מול חברי הקבוצה ואת מגמת השינוי לאורך האירוע.",
  },
  {
    pattern: /(?:phase[\s_-]*(?:error|drift|mismatch|offset)|angle[\s_-]*(?:error|difference|mismatch)|sync(?:hronization)?[\s_-]*(?:loss|error|deviation)|פער\s*זווית|סטיית\s*זווית|פערי\s*פאזה|הפרש(?:י)?\s*הזווית|סנכרון\s*נמוך)/i,
    title: "פער בסנכרון המיקום היחסי",
    guidance: "בדקו את מיקום הרכבים על הנתיב ואת הפרשי הזווית או הפאזה מול התבנית שנבחרה.",
  },
  {
    pattern: /(?:low[\s_-]*speed|speed[\s_-]*(?:low|below)|מהירות\s*נמוכה|מתחת\s*למהירות)/i,
    title: "מהירות נמוכה ביחס לסף",
    guidance: "בדקו את מהירות הרכב ואת איכות נתוני הניווט לפני הסקת מסקנה מציון התנועה.",
  },
  {
    pattern: /(?:missing[\s_-]*(?:navigation|data|samples)|no[\s_-]*(?:navigation|position|data)|stale[\s_-]*(?:data|navigation)|חסר(?:ים)?\s*נתוני|אין\s*נתוני\s*ניווט|נתוני\s*ניווט\s*חסרים)/i,
    title: "נתוני ניווט חסרים או לא עדכניים",
    guidance: "בדקו את רציפות הדגימות, חיבור מקור הנתונים וחותמות הזמן לפני שימוש בציון.",
  },
];

function hasHebrew(value: string) { return /[\u0590-\u05ff]/u.test(value); }
function actionable(value: string) { return /(?:בדקו|בדוק|השוו|וודאו|אמתו|יש\s*לבדוק)/u.test(value); }

export function operatorAlertWording(sourceTitle: string, sourceDetail: string): OperatorAlertWording {
  const title = sourceTitle.trim();
  const detail = sourceDetail.trim();
  const evidence = `${title} · ${detail}`;
  const matched = RULES.find((rule) => rule.pattern.test(evidence));
  if (matched) {
    return {
      title: matched.title,
      detail: hasHebrew(detail) ? `${detail}${actionable(detail) ? "" : ` ${matched.guidance}`}` : matched.guidance,
      sourceTitle,
      sourceDetail,
      recognized: true,
    };
  }
  // A Hebrew free-text alert remains faithful to its source. Unknown English
  // must not masquerade as a verified diagnosis or appear as operator guidance.
  if (hasHebrew(title) && hasHebrew(detail)) {
    return {
      title,
      detail: actionable(detail) ? detail : `${detail} בדקו את פרטי האירוע, עקבת הרכבים והציונים לפני החלטה על פעולה.`,
      sourceTitle,
      sourceDetail,
      recognized: false,
    };
  }
  return {
    title: "התראה מהליבה — הסיבה טרם זוהתה בעברית",
    detail: "התקבלה התראה שלא ניתן לסווג בוודאות. בדקו את עקבות הרכבים, ציוני הסנכרון והנתיב ואת נתוני המקור; אין להסיק סיבה ספציפית מהודעה זו.",
    sourceTitle,
    sourceDetail,
    recognized: false,
  };
}
