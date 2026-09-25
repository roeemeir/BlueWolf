# Blue Wolf — מרשם דרישות קפוא

עדכון: 16/09/2026

מקור האמת המלא הוא `Blue_Wolf_Full_Specification_HE_v2_3.docx` בדרייב. בגרסה זו קיימות **119 דרישות ממוספרות** בעשרה נושאים, ולכל דרישה נשמרים בנפרד: מזהה קבוע, ניסוח, סטטוס מימוש, סטטוס אישור מימוש על ידי המשתמש והערת ראיה/פער.

## משמעות אישור המשתמש — הבהרה מחייבת מ־16/09/2026
- עצם הופעת דרישה במפרט/ב-scope פירושה שהיא דרישה מוסכמת; אין צורך בשדה אישור נפרד לעצם הכללתה.
- `אישור מימוש על ידי המשתמש` פירושו **רק** שהמשתמש ראה/בדק את התוצאה ואישר שהמימוש טוב.
- אין להסיק אישור מימוש מעצם כך שהמשתמש ביקש את הדרישה, הכניס אותה למפרט או אישר את ה-scope.
- כאשר אין ראיה מפורשת לאישור איכות המימוש, סטטוס האישור הוא `pending` ולא `approved`.
- ה-release manifest מפריד לכן בין `scopeApprovedByUser=true` לבין `implementationApproval=pending|approved`.

## חוקי יסוד
- דרישה קפואה (`frozen=true`) אינה משתנה במשמעותה בלי בקשת שינוי מפורשת של המשתמש.
- דרישה שמומשה (`מימוש = כן`) מוגנת מרגרסיה ואסור לדרוס אותה כדי לפשט פיתוח חדש.
- `חלקי` אינו `כן`; UI קיים עם נתוני demo אינו נחשב מימוש של pipeline אמיתי.
- סטטוס בדיקה שלא הורצה הוא `missing/not run`, לעולם לא pass משוער.
- כל איטרציה מתחילה בדרישות שאינן `כן` ומסתיימת בעדכון coverage.
- אין preview/release חלקי לפני סגירת ה-scope, בדיקות בפועל ואישור מימוש מפורש בהתאם למדיניות ה-release.

## נושאי המרשם
1. `BW-GOV-*` — ממשל דרישות, נעילה וגרסאות.
2. `BW-CORE-*` — ליבת זיהוי נתיב, מחזור ושינוי נתיב.
3. `BW-SYNC-*` — תבניות SI/SO, פאזה וציון סנכרון.
4. `BW-DATA-*` — InfluxDB2, שדות Join ואיכות נתונים.
5. `BW-OFF-*` — SQLite וארכיטקטורת Offline.
6. `BW-DEV-*` — כלי מפתחים, Route Bank, GT ו-QA.
7. `BW-UI-*` — ממשק מפעיל ומפה חיה.
8. `BW-REP-*` — תחקור לאחור, recomputation ודוחות PDF.
9. `BW-QA-*` — אימות, CI ופרסום.
10. `BW-DOC-*` — תיעוד הנדסי ומחקר.

## baseline מאומת נוכחי
HEAD מאומת: `51e4cd2eacb15a066a2a62705c232ff34bf62384`.

עברו בהצלחה על אותו HEAD:
- Blue Wolf CI #1272 — Web (lint, TypeScript, tests), Core shards, Offline SQLite restart, runtime packaging ו-lifecycle regressions.
- WKT Browser E2E #125 — עריכת WKT/גרירה/שמירה/refresh/process restart.
- UI/PDF Browser E2E #38 — desktop/mobile readability וכן Canvas PDF עברי/RTL אופליין.

## תכולות עיקריות שכבר נסגרו מאז snapshot ההתאוששות
- SI direct placement: שלוש טבעות × 12 מיקומים, 30°, ללא counters, כולל hover/touch ו-derived relations.
- SO direct placement: מחולל סדרים Single/Double, half/quarter slots, כיוון רכב ו-relations נגזרים.
- WKT source-of-truth + SQLite persistence + browser E2E.
- GT/QA truth-backed ללא מספרי demo.
- Investigation archive/recompute אמיתי עם provenance, group/vehicle graphs, navigation WGS84, arena per event ו-retroactive batch recompute.
- PDF truth-backed; יצוא עברי/RTL מקומי בדפדפן, ללא CDN וללא `window.print()`.
- release gate לפי frozen scope ו-evidence, עם הפרדה חדשה בין scope approval לבין implementation sign-off.

## פערי release-scope פעילים לאחר baseline 51e4cd2
- `BW-REP-008` / `REP-02`: להשלים מפה מסכמת לטווח עם כל האירועים, נתיב מזוהה אמיתי, קבוצה/מספר אירוע, legend ו-gaps אמיתיים.
- `BW-REP-010`: להשלים arena/navigation overlay באופן מלא גם בדוח ובכל מסלול התחקור הרלוונטי.
- `BW-QA-008`: לקבע code/config/build provenance בכל report/GT/release surface.
- `IN-01`: לחבר שמות שדות Join + transformations מה-Developer workspace עד adapter/runtime ולבדוק על sample אמיתי.
- `ARCH-01`: hardening מלא של offline/SQLite — גרסאות, migration/recovery, assets/fonts מקומיים וקליטת Influx ברשת פנימית.
- `PROC-01`: לסנכרן את כל 119 הדרישות מול הקוד/בדיקות/Drive לפני release, ללא הסתמכות על סטטוס היסטורי מיושן.

הטבלה המלאה, כולל כל 119 השורות, נמצאת במפרט Drive v2.3; `docs/REQUIREMENTS_COVERAGE_HE.md` הוא אינדקס ה-CI/פיתוח המקוצר בענף.
