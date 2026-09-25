# Blue Wolf — Requirements Coverage

## מצב נוכחי 22/09/2026

מקור האמת: Master v2.8 ב־Drive, מזהה `1pcjq50LchceDYsCqek_jqxkkRYbnef4l`, ודוח המחקר הכפוף `1OGjS5_xTQN_CGgv-laXOnFOay9J19BbS`; שניהם נקראו מחדש. הענף שנבדק התחיל ב־`7191b5b2ae144f82a860f08571072cfb93a23f24`. PR #6 נשאר Draft. אישור מימוש של המשתמש נשאר ממתין; ניסוחים היסטוריים להלן על אישור כל הדרישות אינם אישור איכות מימוש.

נסקרו 22 הדרישות שאינן yes במרשם של 143 שורות, וכן כל 17 בקשות BW-CR-20260919 שב־Master. נבחרו לתיקון הנדסי BW-REP-001, BW-UI-005, OP-02 ו־OP-04. זו אינה סגירה של יתר הדרישות או של בדיקות מכשיר היעד.

| דרישה | שינוי או ממצא | אימות וגבול |
|---|---|---|
| BW-SYNC-013 | `display-score-smoothing.ts` מפריד ממוצע לפי שרת ועוצר בציון לא סופי | CI #2533 על 7191b5b: שש בדיקות עברו, לרבות מעבר 7→8→9; raw history נשמר. אין שינוי ליבת scoring |
| BW-REP-001, BW-CR-20260919-007 | בדיקת API השתמשה בטווח קבוע עם שעון מערכת מתקדם. השעון הוקפא במסגרת הבדיקה בלבד; חוזה הארכיון לא שונה | 30 אירועים בדיוק בשבעה ימים, ושינוי 4→0 לאירועי היום שפג בחצות מחזיר 422; ללא קריאה ל־Core |
| BW-UI-005 | `operational-live-map.tsx`: cursor היסטורי ללא frame אינו משתמש ב־null המייצג LIVE עבור העקבה | בדיקת רכיב בפועל משחזרת קו חי לפני התיקון ומוודאת אפס קווים לאחריו; frame תקף עדיין קוטע רק מדידות עתידיות |
| OP-02, OP-04, BW-CR-20260919-005 | `live-map-evidence.ts` משמר serverId/groupId; המפה בודקת שרת, קבוצה, אירוע ותבנית. recompute נשלח עם serverId ומורץ מחדש בהחלפת שרת | שש בדיקות רכיב: cache משרת קודם, override שגוי, שרשרת 1→2→3, תשובה מאוחרת ותשובה עם שרת שגוי. תשובה תואמת עדיין מוצגת |
| BW-GOV-010 | הכשל אמיתי: 240 קבצים במניפסט מול 254 ב־7191b5b; digest בפועל b18eae8657ad0ca7 | לא שונתה טביעת אצבע. `docs/DOCUMENTATION_RECONCILIATION_2026_09_22.md` מפרט את פער המקור; סקירה חלקית אינה certification |

ראיות baseline: CI #2533 / run 35685283487: Web 309/311; lint ו־TypeScript עברו. שני כשלים: פער תיעוד ובדיקת תאריכי SIM. 29 עבודות non-Web בדף הראשון הצליחו; API המחבר מחזיר דף אחד בלבד, ולכן אין להסיק ממנו שאין עבודות נוספות. 14 workflows ייעודיים הסתיימו בהצלחה. Quick Tunnel אינו פריסה מאומתת.

ראיות מקומיות לפני commit: baseline ממוקד 23/24; לאחר התיקון 30/30, ולאחר הוספת תרחיש תשובות מאוחרות כל שש בדיקות הרכיב עברו. TypeScript עבר; lint ללא שגיאות ועם 10 אזהרות קיימות. בדיקות הרכיב מפעילות את חישוב ה־SVG וה־effects עם קלט מבוקר; אינן בדיקת פריסת דפדפן או iPhone.

פתוח: BW-GOV-010, reconciliation מלא של שינויי המקור והערות סטטוס היסטוריות ב־Master, חורים שנמחקו לפני איסוף עקבות, snapshot זהה ל־Web/PDF, כל 32 צירופי השכבות, SQLite→Core לתבניות בכל המסלולים, ואימות חזותי/קבלת משתמש לכל 17 הבקשות. אין שינוי של סטטוס דרישה ל־yes על בסיס תיקון זה.

## היסטוריית הכיסוי 15/09/2026

עדכון: 15/09/2026

ה-Marster Registry המלא נמצא במפרט Drive v2.3. snapshot ההתאוששות כולל 119 דרישות: **50 ממומשות**, **36 חלקיות**, **33 לא ממומשות** לפני איטרציית הפיתוח הנוכחית. כל הדרישות במרשם הנוכחי מסומנות `אושר על ידי המשתמש = כן`, מאחר שהן נגזרו מהמפרט הקפוא ומהנחיות המשתמש המפורשות.

| תחום | סטטוס עיקרי | פערים פתוחים מרכזיים |
|---|---|---|
| Governance | חלקי | registry/gate אוטומטי, חסימת release לפי scope |
| Core | ברובו ממומש | אימות event product threshold ושילוב מלא |
| SI/SO Templates | חלקי | SI direct placement; recomputation אמיתי |
| Influx/Data | ברובו ממומש | אימות end-to-end של שמות join מה-UI אל runtime |
| SQLite/Offline | ממומש ומוגן | להמשיך regression בכל איטרציה |
| Developer/Route Bank/GT/QA | חלקי/לא | WKT source-of-truth, GT core-run, QA metrics אמיתיים |
| Operator UI | חלקי | trace/auto-fit/time sync/mute/legend visual QA |
| Investigation/PDF | חלקי/לא | archive truth, recomputation, per-vehicle, PDF truth |
| CI/Release | חלקי | WKT E2E, GT, recompute, PDF, requirements gate |
| Documentation | מעודכן באיטרציה זו | לסנכרן סטטוסים לאחר כל pass בפועל |

## Scope איטרציה 15/09/2026
1. GOV: להכניס guardrails ו-registry לענף העבודה.
2. DEV/QA: להפוך WKT לגאומטריה נבדקת עם regression מול persistence.
3. DEV/QA: להפסיק להציג QA/GT מומצאים ולסמן `not run` עד שיש runner אמיתי.
4. DEV/GT: לחבר ריצת GT לפלט אמיתי של הליבה, כולל scenario/code/config metadata.
5. REP/SYNC: לחבר template replacement ל-recomputation אמיתי של event.
6. REP: לבנות PDF מנתוני אמת בלבד.

## כללי עדכון
1. `כן` רק אחרי מימוש קונקרטי ואימות בפועל.
2. דרישה מאושרת אינה משתנה במשמעות ללא בקשת שינוי מפורשת.
3. לפני refactor של דרישה ממומשת מוסיפים/מריצים regression המגן עליה.
4. כל איטרציה מתחילה בסינון `חלקי`/`לא` ומסתיימת בעדכון הטבלה והמפרט בדרייב.
5. אין לפרסם preview/release חלקי כאשר scope ההפצה כולל דרישה קפואה שלא נסגרה.
