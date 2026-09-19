# זאב כחול — יומן מחקר של ה־Operational Runtime

מסמך זה משלים את `ALGORITHMIC_CORE_RESEARCH_LOG_HE.md`. היומן האלגוריתמי ממשיך לתעד detection/grouping/scoring semantics; כאן מתועדות החלטות application/runtime שאינן שייכות ל־`bluewolf_core` עצמו.

הכלל זהה: אין להפוך השערה לדרישה. כל שינוי משמעותי מתועד כ־Problem → Hypothesis → Spec decision → Experiment → Result → Change → Regression → Performance → Validation → Open questions.

---

## מחקר 14 — חוזה versioned בין Python Core ל־Operator ללא demo-as-live

### Problem / Observation

ה־Operator עבד במקור ישירות מול `SERVER_SCENARIOS` דטרמיניסטיים. מעבר למצב Influx בלי חוזה מבצעי מפורש היה עלול להשאיר ערכי demo על המסך כאשר Python Core אינו זמין, או לגרום ל־Web לנחש שדות שהליבה אינה מספקת.

### Hypothesis

יש להפריד בין האלגוריתם לבין חוזה האפליקציה: `bluewolf_core` יישאר נקי מ־HTTP/UI, ו־`bluewolf_runtime_adapter` יתרגם רק תוצאות מאומתות לחוזה versioned. כל מידע שלא קיים צריך להיות unavailable/invalid ולא fallback לדמו.

### Spec decision

ננעל `bluewolf.live-runtime.v1`:

- source חייב להיות `python-core`.
- server/schema validation חובה.
- משפחה חסרה נשארת unavailable.
- displayed score הוא input מפורש; אין raw fallback.
- position/heading נשלחים רק אם קיימת תצפית אמיתית.
- recommendation אינו מקבל duration מומצא.
- Web משתמש same-origin proxy ומסתיר Core URL/token מהדפדפן.

### Experiment

נוספו regressions ב־Web וב־Python עבור runtime unavailable, partial family, wrong server, simulation restore, displayed-score invalid ו־recommendation ללא שדה לא־נצפה.

### Result

מצב Influx אינו יכול להציג demo score כאילו הוא operational. מצב simulation נשאר deterministic ונפרד. serializer Python וה־normalizer Web חולקים schema מפורש אך אינם מכניסים UI concerns לליבה.

### Code change

`bluewolf_runtime_adapter/contract.py`, Web `lib/live-runtime.ts`, `/api/live-runtime`, וחיבור Dashboard polling.

### Regression

`test_live_runtime_contract`, `live-runtime-contract.test.mjs`, position contract tests.

### Validation

ה־runtime contract נכלל בבסיסי CI ירוקים החל מהשלבים שאחרי Run 672; baseline מלא מאוחר יותר Run 780 ממשיך לכלול אותו.

### Open questions

Displayed-score smoothing עדיין חסר נוסחה; SI operational serializer עדיין נדרש.

---

## מחקר 15 — Restart continuity בלי write amplification

### Problem / Observation

כאשר ה־runtime עבר מ־transport בלבד ל־poll loop אמיתי, restart היה עלול לאבד watermark, event/recommendation streaks, active structural groups ו־live timeline. שמירת checkpoint לאחר כל poll פותרת continuity אך יוצרת כתיבת JSON + `fsync` בתדירות גבוהה, במיוחד לאחר הוספת history.

### Hypothesis

נדרש checkpoint אטומי מלא אך cadence-limited: state-changing tick ראשון נשמר מיד, שינויים נוספים נשארים dirty עד interval קבוע, וב־shutdown מתבצע flush לאחר עצירת thread ה־polling.

### Spec decision

- `bluewolf.operational-state.v1` נשאר schema התאימות.
- configuration fingerprint מונע restore תחת mapping/template/server configuration שונה.
- cadence נגזר מ־`CoreConfig.timing.checkpoint_seconds`; ברירת המחדל היא 300s.
- אם כמה pipelines חולקים state file, נלקח interval הקצר ביותר.
- graceful shutdown: stop/join קודם, `flush_checkpoint()` אחר כך.

### Experiment

נבדקו round-trip של CoreSession/cursor/runtime/producer/latest/history, rejection של fingerprint שונה, שמירה ראשונה מיידית, אי־כתיבה נוספת לפני 300s, כתיבה כאשר interval חלף ו־flush של dirty state בכיבוי.

### Result

Restart continuity נשמר בלי לכתוב state file בכל active poll של 5s. אין race בין thread פעיל לבין shutdown flush.

### Code change

`operational_state.py`, `runtime_host.py`, `environment_factory.py`.

### Regression

`test_operational_history_state`, `test_checkpoint_cadence`, `test_environment_factory`, `test_runtime_host` בתוך shard `operational-pipeline`.

### Performance impact

התיקון מוריד את מספר כתיבות checkpoint במצב active מ־עד 12 כתיבות בדקה לכ־כתיבה אחת ב־5 דקות לאחר השמירה הראשונית, למעט shutdown flush. זה חישוב cadence ולא benchmark דיסק.

### Validation

שכבת history/restart לפני cadence נסגרה ב־Run 780 (`9a6de173...`) success מלא. ה־cadence regressions עברו ב־`operational-pipeline` בריצות המאוחרות יותר לפני superseding pushes.

### Open questions

ב־deployment אמיתי יש למדוד latency של `fsync` על ה־persistent volume הספציפי של OpenShift/Windows.

---

## מחקר 16 — 30 דקות history לפי זמן + חוזה קומפקטי

### Problem / Observation

שתי בעיות נמצאו ב־history הראשון:

1. `360 snapshots` פירושם 30 דקות רק כאשר poll הוא 5s; polling הוא configurable.
2. כל history item היה full `bluewolf.live-runtime.v1` snapshot, כולל כל member, position, heading וטקסט תצוגה. ביעד של כ־10 שרתים / 150 רכבים הדבר מנפח RAM, HTTP ו־checkpoint אף שהגרף משתמש רק בציוני קבוצה.

### Hypothesis

Live operator history צריך להיות time-windowed לפי `observedAt` ולהשתמש בחוזה נפרד המכיל רק data שנדרש ל־timeline. Latest snapshot נשאר מלא.

### Spec decision

נוסף `bluewolf.live-runtime-history.v1`.

כל point מכיל:

- `serverId`, `observedAt`.
- group `id/name/color`.
- `total/sync/route`, `scoreValid`.
- event `id/active` אם קיים.

Retention:

- 1800s ברירת מחדל.
- point בדיוק בגבול נשמר.
- hard cap 2000; API max 5000.
- cutoff מחושב יחסית ל־latest observed data של אותו server, לא wall clock.
- out-of-order old correction מחוץ לחלון אינו מוחזר.

### Experiment

נבדקו:

- 1801s old point נחתך; 1800s boundary נשמר.
- same timestamp מוחלף ולא מוכפל.
- late bootstrap מתמזג עם snapshot חי חדש בלי לדרוס אותו.
- checkpoint חדש שומר compact points.
- checkpoint V1 ישן עם full history snapshots מומר בזמן restore.
- V1 ללא runtimeHistory עדיין משחזר latest.
- unavailable Web fallback אינו נכנס לגרף.

### Result

ה־Operator מקבל 30 דקות אמיתיות ללא תלות ב־poll cadence, וה־latest endpoint נשאר ללא שינוי. Web ו־Python משתמשים באותו history schema versioned. Restart continuity נשמר גם לאחר migration.

### Code change

`history_contract.py`, `service.py`, `operational_state.py`, `lib/live-runtime-history.ts`, `operational-timeline.tsx`, history API proxy והבדיקות המתאימות.

### Regression

`test_runtime_history`, `test_operational_history_state`, `live-runtime-history.test.mjs`.

### Performance impact

נוסף `test_runtime_history_footprint.py` כ־serialization-size guard דטרמיניסטי:

- compact point חייב להיות לפחות פי 10 קטן מ־full live snapshot מייצג של 15 רכבים.
- 10 שרתים × 30 דקות × 5s poll נשארים מתחת ל־1MB עבור points מייצגים.
- 1s poll × 30 דקות = 1801 points ונכנס ב־default cap 2000.

מדידת פיתוח מייצגת הייתה כ־6.9KB ל־full snapshot מול כ־0.26KB ל־compact point, בערך 27× חיסכון. זו מדידת payload מייצג ולא guarantee של production workload.

### Validation

ה־compact contract עבר `runtime-service`, `operational-pipeline`, Web ו־runtime packaging ב־Run 796 על head ביניים לפני superseding push. `test_runtime_history_footprint` נוסף ל־CI ב־code head `b3a7e0404f6369baa65bcd9ae40d278cc1a92b64`; baseline מלא חדש ייקבע לאחר run שאינו cancelled.

### Open questions

- load campaign מלא ל־10 servers / 150 vehicles צריך למדוד CPU, resident memory, Influx latency, Core latency, HTTP latency ו־persistent-volume checkpoint latency.
- live 30-minute history אינו archive לתחקור; After Action דורש persistence נפרד.
- יש לבחון downsampling רק אם נתוני אמת יראו ש־1s history מיותר לגרף; אין לבצע אותו כרגע ללא דרישת מוצר.

---

## כלל עדכון

שינוי runtime משמעותי שמוסיף state, משנה transport/persistence או משפיע על failure semantics חייב לקבל entry כאן ורגרסיה קבועה לפני קידום baseline.
