# Blue Wolf — Requirements Coverage

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