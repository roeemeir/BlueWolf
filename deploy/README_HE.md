# זאב כחול — פריסת Runtime מבצעי ושער QA מחייב

עודכן: 23/09/2026. [שער הקבלה המלא](../docs/E2E_QA_RELEASE_GATE_HE.md) ונספח `QA-E2E-20260923` ב־Master המקורי גוברים על כל ניסוח קודם שאפשר למסור קישור לגרסת Web בלבד. **אין למסור קישור לבדיקת מערכת בלי אימות אינטגרציה מקצה לקצה של Web, SQLite, Python Core מבצעי, InfluxDB2, אירועים, תחקור ו־PDF באותה סביבה.** קישור שהחזיר HTML 200 אינו גרסת QA תקינה.

## ארכיטקטורת ריצה ומה נדרש לחבר

מעטפת `bluewolf-runtime` ב־`core/` כוללת ASGI, מאגר snapshots, מפיק תוצאות Core, InfluxDB2 adapter, מתאם join/פולינג, ארכיון דגימות ואירועים, ממשקי recompute ו־QA. היא **אינה מפעילה את לולאת העיבוד התפעולית רק מעצם הפעלת ה־API**. יש להגדיר `BLUEWOLF_OPERATIONAL_CONFIG` כקובץ JSON תפעולי מלא; אז `runtime_host.host_from_environment` בוחר את `mixed_environment_factory` ומקים לולאת Core המפרסמת snapshots לאותו תהליך API. בלעדיו השירות במצב `transport-only` ועשוי להחזיר HTTP 200 ב־`/healthz` בלי לחשב נתיב/ציון אחד.

ה־store עדיין process-local: הפעילו עובד יחיד ו־replica אחד ל־Runtime עד פתרון שיתוף ואחסון משותף. תצורת ה־Core/Influx וה־SQLite של Web אינן מחוברות אוטומטית ביניהן; נדרש להגדיר נתיבי תצורה, token, רשת, התמדה והרשאות נכונים ולוודא שפעולות שמירה ב־Web אכן נכנסות לתוקף ב־Core. `BLUEWOLF_OPERATIONAL_CONFIG` הוא קובץ ציבורי ללא סודות; `BLUEWOLF_INFLUX_TOKEN` ו־`BLUEWOLF_CORE_API_TOKEN` נשמרים רק במנגנון סודות מאובטח.

## הפעלה ואימות תפעולי

- בנו והתקינו image מן `deploy/runtime/Dockerfile` או התקנת Windows באמצעות `deploy/windows/install-runtime.ps1`, בהתאם לסביבת היעד; קובץ `deploy/runtime/operational-config.example.json` הוא דוגמה בלבד, לא תצורה מוכנה להפעלה. החליפו URL, bucket, server tags, מיפוי שדות, קבוצות, רכבים ותבניות בערכים מאומתים.
- הגדירו `BLUEWOLF_OPERATIONAL_CONFIG`, `BLUEWOLF_INFLUX_TOKEN`, `BLUEWOLF_RUNTIME_HOST`, `BLUEWOLF_RUNTIME_PORT`, והגדרות `BLUEWOLF_OPERATIONAL_STATE_PATH`/ארכיון כאשר נדרשת רציפות. Web חייב לפנות לאותו Core דרך `BLUEWOLF_CORE_API_URL` עם אותו מנגנון הרשאות.
- אימות שירות: `GET /healthz` מאשר שהשרת מאזין **בלבד**. `GET /readyz` חייב להחזיר `mode: operational`, `ok: true`, `running: true`, שני טיקים לפחות ו־`serverErrors` ריק. לאחר מכן בודקים `GET /v1/live-runtime?serverId=...` עבור שלושת השרתים — זמן מקור מתקדם, WGS84 נצפה, נתיב מזוהה בליבה, SI/SO וציונים תקפים. כישלון או חוסר נתוני מקור הוא חסם, אין להחליף אותו בדמו.
- במערך אופליין מותקן, מגדירים `BLUEWOLF_STORAGE=sqlite` ו־`BLUEWOLF_SQLITE_PATH` לקובץ SQLite קבוע, בודקים כתיבה/קריאה בין לקוחות והתמדה לאחר restart. Web ו־Core צריכים להיחשף דרך מקור מפעיל אחד, עם ממשקי האירועים, התחקור וה־PDF המחוברים לראיות המקוריות.

## מסירת גרסת בדיקות

ה־workflow ההיסטורי `qa-quick-tunnel.yml` **אינו מפרסם יותר Tunnel/קישור**. הוא מפעיל בדיקת קדם פרטית בלבד ודורש הגדרות Influx/Core אמיתיות; ללא credentials או ללא דגימות מתעדכנות הוא נכשל במכוון. אפילו הצלחת קדם־בדיקה אינה מספיקה: חובה להוכיח שמירת תבנית והחלתה במנוע, אירוע ושחזור מתחילתו, דוח PDF ו־scatter/מפות, restart, תרחישים משתנים בשלושה שרתים, בדיקת דפדפן/iPhone, התאמת שני מסמכי המקור וביקורת `BW-GOV-010`. אין לפרסם URL עד שכל התנאים עוברים באותו HEAD וסביבת בדיקה.

לא למזג ל־`main`, לא להפוך PR מ־Draft ולא לשחרר לייצור ללא אישור מפורש של בעל המוצר.
