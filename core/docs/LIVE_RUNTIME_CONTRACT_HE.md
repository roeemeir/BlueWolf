# חוזי Live Runtime מבצעיים — Python Core ↔ Operator

## מטרה

מסמך זה מגדיר את גבול האפליקציה בין הליבה המבצעית ב־Python לבין ממשק ה־Operator. הוא אינו משנה את חוקי זיהוי הנתיב, הקיבוץ או הציון של `bluewolf_core`; הוא מתאר רק כיצד תוצאות מאומתות נחשפות ל־Web וכיצד נשמר history חי קצר.

הארכיטקטורה נשארת מופרדת:

`bluewolf_core` — אלגוריתם בלבד, ללא HTTP/Influx/UI.

`bluewolf_runtime_adapter` — composition מבצעי, Influx polling, serialization, persistence ו־ASGI service.

`Web / Operator` — צרכן של חוזים versioned דרך same-origin proxy.

---

## 1. Latest runtime — `bluewolf.live-runtime.v1`

ה־endpoint המבצעי הוא:

`GET /v1/live-runtime?serverId=<id>`

ה־Web אינו ניגש אליו ישירות. הוא קורא:

`GET /api/live-runtime?serverId=<id>`

וה־Next.js proxy מעביר את הבקשה ל־Python Core לפי `BLUEWOLF_CORE_API_URL`. אם מוגדר `BLUEWOLF_CORE_API_TOKEN`, הוא נשלח כ־Bearer token מהשרת בלבד ואינו נחשף לדפדפן.

ה־latest snapshot הוא payload מלא של המסגרת הנוכחית: קבוצות, ציונים, חברי קבוצה, מיקום/heading כאשר נצפו, event/alert/recommendation ומטא־דאטה תצוגתי. הוא נשמר במלואו רק כ־latest לכל שרת.

### Fail-closed

- אם runtime אינו מוגדר/זמין, ה־Operator אינו משאיר ציוני demo כאילו היו operational.
- משפחה חסרה ב־payload נשארת unavailable; אין backfill מסימולציה.
- `displayed_group_score` אינו מוחלף אוטומטית ב־raw total.
- recommendation אינו מקבל `sustainedSeconds` מומצא אם הנתון אינו קיים בליבה.

---

## 2. Live history — `bluewolf.live-runtime-history.v1`

ה־timeline החי משתמש בחוזה נפרד:

`GET /v1/live-runtime/history?serverId=<id>&limit=<n>`

וה־Web קורא אותו דרך:

`GET /api/live-runtime/history?...`

ה־history אינו אוסף של live snapshots מלאים. כל point מכיל רק את המידע הנדרש לגרף:

- `serverId`
- `observedAt`
- לכל קבוצה: `id`, `name`, `color`
- `total`, `sync`, `route`
- `scoreValid`
- event פעיל: `id`, `active`

אין ב־history point:

- vehicle members
- latitude/longitude/heading
- arena/status
- template payload מלא
- reason/success strings

כך ה־timeline אינו משכפל את כל מצב 150 הרכבים בכל poll.

### Retention

ברירת המחדל היא **30 דקות לפי זמן תצפית**, לא מספר קבוע של samples.

- `BLUEWOLF_RUNTIME_HISTORY_SECONDS=1800`
- hard cap ברירת מחדל: `BLUEWOLF_RUNTIME_HISTORY_LIMIT=2000`
- limit מקסימלי לשאילתה: `5000`

החלון מחושב ביחס ל־`observedAt` החדש ביותר של אותו שרת. נקודה בדיוק בגבול 30 דקות נשמרת; נקודה ישנה יותר נחתכת. late correction ישן מחוץ לחלון אינו מחזיר history שכבר פג.

ה־hard cap הוא שכבת הגנה לזיכרון. ב־poll של שנייה אחת, חלון של 30 דקות כולל 1,801 נקודות ולכן עדיין נכנס בברירת המחדל של 2,000.

---

## 3. Ordering, corrections ו־race

גם ה־Python store וגם ה־Web cache:

- ממיינים לפי `observedAt`.
- עושים dedup לפי אותו timestamp.
- same-timestamp correction מחליף את ה־point הקודם.
- out-of-order point יכול להיכנס למקומו ההיסטורי אך אינו מחליף latest חדש יותר.
- bootstrap history שמגיע אחרי snapshot חי חדש מתמזג ואינו דורך עליו.
- unavailable fallback שנוצר בצד ה־Web אינו מתווסף ל־history המבצעי.

---

## 4. Restart continuity

`bluewolf.operational-state.v1` שומר:

- `CoreSession` checkpoint
- polling cursor/watermark
- `LiveSOEventRuntime` state
- producer structural state
- latest full runtime snapshot
- `runtimeHistory` קומפקטי

ה־schema נשאר V1 לצורך תאימות. restore תומך בשלוש צורות קיימות:

1. checkpoint חדש עם compact `runtimeHistory`.
2. checkpoint V1 ישן שבו `runtimeHistory` מכיל full `bluewolf.live-runtime.v1` snapshots — הם מומרים ל־history points בזמן הטעינה.
3. checkpoint V1 ישן ללא `runtimeHistory` — ה־latest snapshot עדיין משוחזר ומזריע נקודת history אחת.

שינוי fingerprint של הקונפיגורציה המבצעית מונע שחזור state תחת מיפוי Influx/template/server bindings אחרים.

---

## 5. Checkpoint cadence ו־I/O

ה־history הקומפקטי נשמר בקובץ state אטומי, אך הקובץ אינו נכתב בכל poll.

- state-changing tick ראשון נשמר מיד.
- שינויים נוספים מסומנים dirty.
- כתיבה נוספת מתבצעת רק לאחר `CoreConfig.timing.checkpoint_seconds` — ברירת מחדל 300 שניות.
- אם כמה pipelines חולקים state file, נבחר interval הקצר ביותר שהוגדר ביניהם.
- shutdown מסודר עוצר קודם את thread ה־polling ואז מפעיל `flush_checkpoint()` אם נשאר dirty state.

כך נשמרת restart continuity בלי write amplification של קובץ history בכל 5 שניות.

---

## 6. Footprint guard

`test_runtime_history_footprint.py` הוא guard דטרמיניסטי של serialization size, לא benchmark זמן של CI.

הוא נועל שלוש דרישות:

- history point קומפקטי קטן לפחות פי 10 מ־live snapshot מייצג של 15 רכבים.
- 30 דקות × 10 שרתים ב־poll של 5 שניות נשארות מתחת ל־1MB עבור history points מייצגים.
- 30 דקות ב־poll של שנייה אחת נכנסות ב־hard cap ברירת המחדל של 2,000 points.

מדידה מקומית מייצגת בזמן פיתוח נתנה בערך 6.9KB ל־full live snapshot מול כ־0.26KB ל־compact history point, אך המספר המדויק תלוי בתכולת הקבוצה ולכן אינו מוגדר כחוזה מוצר.

---

## 7. גבולות שעדיין פתוחים

- נוסחת displayed-score smoothing עדיין אינה מוגדרת. `displayed_smoothing_seconds=10` לבדו אינו נוסחה, ולכן operational displayed score נשאר fail-closed עד החלטת מפרט.
- החוזה המבצעי הנוכחי ממומש עבור SO; SI live publication עדיין דורש חיבור מקביל.
- ה־30 דקות הן live operator history. תחקור/After Action ארוך טווח דורש persistence/archive נפרד ואינו צריך להסתמך על process-local cache.
- נדרש benchmark עומס מבצעי מלא שיכלול גם CPU, Influx query latency, Core processing ו־HTTP, ולא רק serialization footprint.
- `DOUBLE_FIGURE_EIGHT` נשאר Undefined עד אפיון גאומטרי מפורש.
