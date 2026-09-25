# זאב כחול — יומן מחקר חי של הליבה האלגוריתמית

מסמך זה הוא בן־הלוויה ה־version-controlled של דוח ה־Word המחקרי. מטרתו לשמור בתוך הריפו את ההיסטוריה ההנדסית של כל שינוי אלגוריתמי: מה נצפה, מה הונח, איזה ניסוי בוצע, מה נשבר, מה תוקן ואיזה regression נועל את המסקנה.

מסמכי המקור המחייבים נשארים:

1. `ROUTE_GEOMETRY_SPEC_HE.md` — גאומטריה, topology וסימולטור.
2. `ADAPTIVE_ROUTE_LIFECYCLE_HE.md` — Candidate/Confirmed/Replacement וחלונות אדפטיביים.
3. `AUTOMATIC_ROUTE_DETECTION_V2_HE.md` — תכן ומימוש גילוי אוטומטי.
4. `DOUBLE_HIPPODROME_SCORING_SEMANTICS_HE.md` — active-lobe/role switching.
5. `V1_SPEC_HE.md` — מפרט המוצר הרחב.
6. `EVENT_ALERT_LIFECYCLE_HE.md` — אירועים, low-score alerts והמלצות תבנית.
7. `LIVE_SO_EVENT_RUNTIME_HE.md` — composition של scoring פעיל/חלופי ל־Event Engine.

אם קיים חוסר או סתירה סמנטית, יומן המחקר אינו רשאי להמציא דרישה; עוצרים ומעדכנים את מסמך האפיון המתאים לפני שינוי קוד.

## חוזה תיעוד וספים פעילים — current-head

כדי למנוע מצב שבו דוח המחקר מתאר אלגוריתם אחד והקוד מריץ אחר, נוסף `ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json`. הקטלוג מכסה 85 שדות config פעילים/תאימות מ-`CoreConfig`, `LivePollConfig` ו-`EventAlertConfig`, וכן 12 החלטות אלגוריתמיות מרכזיות. לכל threshold נשמרים:

- הערך המדויק בקוד.
- סיווג: `product`, `calibration`, `implementation_guard` או `compatibility`.
- rationale הנדסי שמסביר למה הערך/המנגנון קיים.
- source symbol בקוד.
- עבור החלטות אלגוריתמיות: alternatives שנדחו ו-evidence/regressions.

`test_threshold_catalog.py` רץ ב-fundamentals shard ומשווה את הקטלוג ישירות ל-defaults של dataclasses. שינוי default ללא עדכון התיעוד נכשל ב-CI; שדה compatibility אינו רשאי להופיע כ-active gate.

### Supersessions שנשמרים במפורש ולא מוסתרים

| נושא | Baseline V1 היסטורי | current-head פעיל | סיבה |
|---|---|---|---|
| Route acquisition | המתנה קבועה 5 דקות | evidence-driven; legacy timers = 0 | זמן שחלף אינו evidence |
| Material geometry change | 20% | 10% default, configurable | BW-CORE-009 |
| Change confirmation | 120s timer | evidence purity + retrospective onset; 120s compatibility בלבד | מונע latency שרירותי ו-intermediate replacement |
| Active Influx polling | 5s | 3s active poll + 5s safe watermark | BW-DATA-010 מוכיח <10s עם InfluxDB2 אמיתי |

`V1_SPEC_HE.md` שומר את הנוסחים ההיסטוריים לצורך traceability אך מסמן אותם `superseded` ומציג לפניהם current-head override. ה-Full Spec נשאר מקור האמת המחייב.
## תבנית חובה לכל milestone אלגוריתמי חדש

### Problem / Observation
מה הבעיה שנצפתה או מה התכולה שנדרשת.

### Hypothesis
הסבר הנדסי שניתן לבדיקה. אין לרשום השערה כמסקנה לפני ניסוי.

### Spec decision
איזה סעיף במפרט קובע את ההתנהגות. אם התקבלה הבהרה חדשה — לאיזה מסמך דרישות נוספה.

### Experiment / Simulation
תרחיש, seed/טווחים רלוונטיים, סוג רעש/רוח/חוסר תקשורת, cadence ו־period לפי הצורך.

### Result
תוצאה כמותית או התנהגותית, לרבות failure אם קיים.

### Code change
המודולים והעיקרון ששונו. לא רק רשימת קבצים אלא הסיבה לשינוי.

### Regression
הבדיקה הקבועה שנוספה כדי למנוע חזרת הכשל.

### Performance impact
השפעה על זמן/זיכרון אם נמדדה. מדידת CI אינה מוצגת כ־benchmark פורמלי ללא סביבת benchmark קבועה.

### Validation
commit ו־CI שמאמתים את השינוי.

### Open questions
שאלות שלא הוגדרו עדיין במפרט או שדורשות נתוני אמת לכיול.

---

## מחקר 1 — מעבר מהמתנה קבועה לזיהוי אדפטיבי

### Problem / Observation
גרסה מוקדמת דרשה חמש דקות לפני `ROUTE_CONFIRMED`. מסלול קצר וברור המתין זמן מיותר, בעוד מסלול ארוך עלול עדיין לא להשלים ראיות גאומטריות מספקות אחרי אותו זמן.

### Hypothesis
זמן שחלף אינו ראיה. Confirmation צריך להתרחש ברגע שקיימים fit, coverage, travel/recurrence ו־closure מספקים.

### Spec decision
`ADAPTIVE_ROUTE_LIFECYCLE_HE.md`: 40 דקות הן `memory ceiling` בלבד; אין timer של 5 דקות.

### Experiment / Simulation
מחזורים קצרים וארוכים, cadence של 1/2/5 שניות, approach לפני הנתיב ורעש.

### Result
אפשר לאשר מסלול במהירות שתלויה בגאומטריה ובמחזור עצמו, בלי לקבוע זמן אחיד לכל הנתיבים.

### Code change
חיפוש geometric re-observation + adaptive suffix growth + refinement. `adaptive_window_refine_seconds` הוא רזולוציית חיפוש בלבד.

### Regression
`fast-period-acquisition`, `free-approach-attribution`, `initial-confirmation-geometry`.

### Validation
מאומת במטריצת ה־CI הנוכחית.

---

## מחקר 2 — Masked spatial recurrence ו־FFT

### Problem / Observation
יש לחשב recurrence על עד 40 דקות history בלי מטריצת מרחקים `N×N`, תוך שמירת missing samples מפורשים.

### Hypothesis
את סכום המרחקים הריבועיים לכל lag ניתן לפרק לסכומי נורמות ומכפלות פנימיות ולחשב באמצעות correlations ב־FFT.

### Experiment / Simulation
Hippodrome עם אובדן דגימות חריף בפניות, כך שעיקר הראיות הן legs שחוזרים מחזור למחזור.

### Result
מינימום recurrence נשמר גם כאשר חלק גדול מהפניות חסר. החישוב הסדרתי על היסטוריה מלאה הוא `O(N log N)` בשלב הצעת המחזור, ללא מטריצת `N×N`.

### Code change
`vector_trajectory.py`: `masked_lag_mse`, local lag refinement, periodic support mask ו־phase fold.

### Regression
`test_vector_trajectory`, `test_vector_route_detection`, classifier sweeps עם turn outages.

### Open questions
כיול ספי recurrence על נתוני אמת; הארכיטקטורה אינה תלויה ב־DBSCAN כמנוע ראשי.

---

## מחקר 3 — Coverage שאינו תלוי cadence

### Problem / Observation
Coverage ישן ספר `occupied bins / 64`. במסלול period=60s עם sample כל 5s ניתן לקבל רק כ־12 פאזות ישירות למחזור ולכן אפילו מסלול מושלם לא יכול לעבור 45%.

### Hypothesis
Coverage צריך למדוד קשת פאזה נצפית ולא צפיפות bins בלבד.

### Result
שתי פאזות סמוכות מקבלות credit לקשת שביניהן רק כאשר phase gap קטן מהסף המאושר. מסלול sparse אך מפוזר סביב כל המחזור מקבל coverage מלא; חצי מסלול רציף נשאר בערך חצי.

### Code change
`_phase_coverage_fraction` הוחלף ל־circular phase coverage.

### Regression
Fast acquisition עם period קצר ו־cadence 5s.

---

## מחקר 4 — גאומטריה ראשונית שגויה ו־false replacement ב־SI

### Problem / Observation
שימוש רק בנקודות שקיבלו direct recurrence support יצר Circle מאושר עם short-axis קטן באופן חריג (כ־42.5m במקרה regression) ולאחר מכן אותה נסיעה נראתה בטעות כשינוי route.

### Hypothesis
Recurrence צריך להוכיח את גבולות המקטע המחזורי, אבל הגאומטריה המאושרת צריכה להשתמש בכל observations האמיתיים שבתוך הגבולות האלה.

### Result
הגאומטריה הראשונית יציבה, ו־stable route אינו מייצר replacement שווא.

### Code change
Confirmed geometry נבנית מכל observations בין first/last recurrent samples; interpolation נשאר geometry hypothesis בלבד.

### Regression
`initial-confirmation-geometry`, `stable-route`.

---

## מחקר 5 — Approach שקיבל recurrence שווא

### Problem / Observation
Approach לינארי שחצה מרחבית את אזור הנתיב קיבל periodic support כאשר הבדיקה הייתה spatial-only; `periodic_start` הוקדם לעשרות שניות לפני הכניסה האמיתית למסלול.

### Hypothesis
כאשר קיימת velocity אמינה בשני קצות זוג recurrence, נקודות מחזוריות צריכות להיות עקביות גם ב־heading.

### Experiment / Simulation
Approach שחוצה את אזור הנתיב ולאחריו מסלול מחזורי; אותו תרחיש גם ללא velocity כדי לוודא שלא נוצרת תלות חובה במהירות.

### Result
עם velocity, crossing חד־פעמי אינו מקבל recurrence שווא. כאשר velocity חסרה, spatial evidence נשאר חוקי ולא נשבר תרחיש turn-loss.

### Code change
Heading consistency אופציונלי בתוך `periodic_support_mask`.

### Regression
`free-approach-attribution`.

### Open questions
כיול heading tolerance על נתוני אמת.

---

## מחקר 6 — Invalid polygon שסווג כ־Double

### Problem / Observation
במצב גאומטריה לא תקינה, ערך concavity=0 פורש בטעות כראיית concavity חזקה והעלה SI חלקי/רועש לכיוון Double.

### Hypothesis
Invalid geometry היא העדר evidence ולא evidence לטופולוגיה מורכבת.

### Code change
Invalid polygon מחזיר `no concavity evidence`; נוספו recurrence prerequisites לפני solver כבד.

### Regression
SI partial recurrence / classifier sweep.

---

## מחקר 7 — CLOCKWISE tangent double-flip

### Problem / Observation
ה־canonical centerline של V2 כבר מסודר לפי סדר התנועה, אך `route_change_suspected` הפך tangent פעם נוספת כאשר `direction=CLOCKWISE`.

### Result
מהירות תקינה לאורך centerline clockwise נראתה כ־mismatch ויכלה לפתוח replacement search שווא.

### Code change
הוסר ההיפוך הכפול; canonical tangent הוא authoritative לכיוון traversal.

### Regression
Clockwise stable-route tangent regression.

---

## מחקר 8 — סדר אירועים Batch לעומת Streaming

### Problem / Observation
מיון `changes` גלובלי לפי `change_time_utc` יצר סדר שונה ב־Batch גדול לעומת Streaming, משום שאירוע רטרואקטיבי יכול להתגלות רק מאוחר יותר.

### Spec decision
`change_time_utc` מייצג attribution; סדר מערך ה־output מייצג emission/detection deterministic order.

### Result
Batch, incremental ו־checkpoint replay יכולים להיות שקולים בלי לאבד onset רטרואקטיבי.

### Regression
Integrated-session determinism.

---

## מחקר 9 — Grouping אינו Scoring

### Problem / Observation
יש להבטיח שירידת ציון לא תפרק קבוצה מבנית.

### Spec decision
Membership נקבע רק לפי route geometry + base period + reliability/lifecycle. SI משתמש ב־complete-link למניעת center chaining; SO משתמש connected chain מפני ש־Route Instances שכנים הם מבנה חוקי.

### Result
`group_id` נשמר ב־60% overlap; merge מקבל מזהה חדש; no-data hold ו־SI wrong-direction lifecycle נפרדים מהציון.

### Regression
`test_grouping`, `test_group_lifecycle`, `test_integrated_session`, checkpoint tests.

---

## מחקר 10 — Semantic phase ו־Figure-8

### Problem / Observation
Raw detector phase תלוי ב־phase zero ובסדר canonical polyline של כל stream ולכן לא ניתן להשוות אותו ישירות בין רכבים.

### Hypothesis
יש להגדיר frame גאומטרי משותף: Q0 בקצה החיובי של major axis, sign קנוני/קבוצתי, ו־semantic phase בלתי תלוי ב־raw zero.

### Result
SO routes מקבלים `semantic_phase` נפרד. ב־Figure-8, position בלבד אינו מספיק בחצייה; velocity/tangent בוחר branch, ובהיעדר heading מספיק אין phase מומצא.

### Regression
`test_so_phase`, `test_semantic_session`, Batch/Incremental/checkpoint equivalence.

---

## מחקר 11 — Double Hippodrome active-lobe / role switching

### Problem / Observation
הבהרת המוצר קבעה ש־Double אינו "פאזה כפולה שמקפלים ב־2" לצורך scoring. הוא נתיב פיזי רציף אחד, אך בכל רגע הרכב משחק את התפקיד על ה־Hippodrome הלוגי שבו הוא נמצא. במעבר בין שני החלקים התפקיד יכול להתחלף.

### Spec decision
נוסף `DOUBLE_HIPPODROME_SCORING_SEMANTICS_HE.md`:

- full-double phase נשמר ל־recurrence/period/lifecycle;
- active-lobe semantic phase משמש Quarter/template/scoring;
- אין role לפי vehicle ID;
- position בוחר lobe כאשר חד־משמעי;
- connection ambiguity נשברת לפי velocity/tangent;
- אם הראיות אינן מספיקות, אין role או semantic phase מומצא.

### Experiment / Simulation
שני lobes שונים, מעבר יחיד, מעבר מלא על הגבול החיצוני, שני רכבים שמחליפים roles, connection עם/בלי heading.

### Code change
`double_lobe_geometry.py`, `double_lobe_phase.py`, הרחבת `VehicleFrameResult` עם `active_so_component_id`, וחיבור ל־`semantic_session.py`. רכיבי ה־Double הם derived geometry דטרמיניסטי ולא operational state חדש.

### Regression
Shard ייעודי `double-lobe-phase`, נוסף לכל מטריצת ה־CI.

### Validation
`spec-conformant-vector-core @ 7f917412e1e89d8d47eabf980a2c26c22041ef80` — CI מלא ירוק.

### Open questions
אין חסם סמנטי ל־active-lobe.

---

## מחקר 12 — Event/Alert + Template Recommendation lifecycle

### Problem / Observation
לאחר השלמת template selection ו־live SO scoring עדיין חסרה שכבה stateful שמתרגמת score רציף להתראות, שומרת event boundaries ומנהלת recommendation בלי להשפיע על route/group membership. ללא state מפורש קיימת גם סכנה ש־restart יאפס streak של alert/recommendation וייצר התנהגות שונה מריצה רציפה.

### Hypothesis
יש להפריד לשלושה state machines: event context, low-score alert hysteresis ו־template recommendation. כל state machine צריך להיות checkpointable, ו־score לעולם לא ישנה grouping או active template בעצמו.

### Spec decision
`V1_SPEC_HE.md` סעיפים 7, 8 ו־11 ו־`TEMPLATE_SELECTION_LIFECYCLE_HE.md` קובעים low-score alert לאחר 10 שניות מתחת ל־50, recovery לאחר 20 שניות ב־60 ומעלה, recommendation לאחר יתרון 30 נקודות ל־120 שניות, סגירה לאחר יתרון קטן מ־15 ל־30 שניות, rejection עד סוף האירוע ו־event finalization לאחר 120 שניות.

### Experiment / Simulation
נוספו 11 regressions דטרמיניסטיים: פתיחת אירוע, alert opening/recovery, score חסר באמצע streak, recommendation opening/close, החלפת best alternative, rejection event-scoped, context change, delayed finalization, checkpoint באמצע שני streaks וסיום event בזמן alert פעיל.

### Result
ה־Event/Alert engine אינו משנה template selection או group membership. `change_time_utc` מייצג זמן פליטה, בעוד onset/recovery evidence נשמר בפרטים. Event שנסתיים נשמר 120 שניות לפני `EVENT_CLOSED` סופי, ו־checkpoint roundtrip משמר את חלונות הראיות הפעילים.

### Code change
נוסף `event_alert.py` עם `EventAlertEngine`, `EventObservation`, `EventAlertConfig`, snapshot/export/restore. ה־public API הורחב, ונוסף shard CI ייעודי `event-alert`.

### Regression
`test_event_alert` — 11 תרחישי lifecycle קבועים.

### Validation
`spec-conformant-vector-core @ f9442f0716c37b5cf6f96bc778bec745eaad7eef` — `Blue Wolf CI` run `652`, success.

---

## מחקר 13 — Runtime composition ללא double-advance של temporal evidence

### Problem / Observation
לאחר שה־scorer וה־Event Engine עבדו בנפרד, חיבור נאיבי של recommendation יכול היה לקרוא את `LiveSOMetricsEngine` פעם אחת עבור התבנית הפעילה ופעם נוספת עבור כל חלופה. במקרה כזה עצם מספר התבניות בבנק היה משנה `dt`, phase-rate ו־curvature history — כלומר evaluation של recommendation היה משנה את המדידה שהוא אמור רק לצרוך.

בנוסף, `V1_SPEC_HE.md` קובע שהתראת score נמוך פועלת על הציון המוצג והמוחלק, אך אינו מגדיר אלגוריתם smoothing; והוא קובע יתרון של 30 נקודות להמלצת תבנית בלי לומר אם ההשוואה היא לפי `sync` או `total`.

### Hypothesis
יש להתקדם temporal state פעם אחת בלבד לכל member/timestamp, לשמור את `SOScoringObservation` כתצפית immutable, ולנקד את כל החלופות מאותו snapshot. החלטות smoothing וממד comparison שאינן מוגדרות במפרט חייבות להישאר inputs מפורשים ולא defaults מומצאים.

### Spec decision
נוסף `LIVE_SO_EVENT_RUNTIME_HE.md`:

- temporal metrics מתקדמים פעם אחת בלבד.
- active selection מגיע רק מ־`SOTemplateSelectionRegistry`.
- החלופות מגיעות רק מן bank הרלוונטי ומנוקדות על ידי `score_so_template()` הקיים.
- displayed/smoothed score מוזן מבחוץ עד שה־smoothing contract יוגדר.
- `TemplateComparisonDimension` חייב להיות `SYNC` או `TOTAL` באופן מפורש; אין default שקט.
- event `context_key` כולל constellation, active template ו־confirmed route identity/geometry-period metadata, אך אינו כולל progress רגעי או active Double lobe.

### Experiment / Simulation
נוספו 5 regressions:

1. שתי תבניות מנוקדות מאותו temporal snapshot וה־frame הבא עדיין רואה `dt=5s` ולא זמן מעוות עקב evaluation כפול.
2. חלופה יציבה טובה ביותר מ־30 נקודות מייצרת `TEMPLATE_SUGGESTED` לאחר 120 שניות evidence.
3. context key נשאר זהה בזמן progress רגיל ומשתנה כאשר active template משתנה.
4. checkpoint באמצע recommendation streak משמר את תחילת ה־evidence ואת זמן ההצעה הסופי.
5. raw group score אינו משמש במקום displayed score כאשר ה־caller מסמן displayed score כלא תקף.

### Result
מספר התבניות החלופיות אינו משנה temporal state. recommendation ו־event lifecycle צורכים את אותו snapshot שכבר שימש לתבנית הפעילה. שינוי active template פותח context חדש, בעוד progress רגיל ומעבר Double בין lobes אינם עושים זאת. שתי ההחלטות שעדיין אינן מוגדרות במוצר נשארו מפורשות במקום להיקבע בקוד ללא מקור.

### Code change
נוסף `live_so_event_runtime.py` עם `LiveSOEventRuntime`, `LiveSOEventRuntimeResult`, `TemplateComparisonDimension` ו־`build_so_event_context_key`. ה־public API הורחב ונוסף shard CI `live-so-event-runtime`.

### Regression
`test_live_so_event_runtime` — 5 תרחישים קבועים.

### Performance impact
ה־temporal metric pass נשאר יחיד. עלות החלופות היא fitting/scoring על snapshot קיים ואינה כוללת projection/temporal history update נוסף. אין benchmark פורמלי נפרד בשלב זה.

### Validation
`spec-conformant-vector-core @ 7b938ca87747031ab299500ec55c33ebc11c4f50` — `Blue Wolf CI` run `659`, conclusion `success`, כולל Web מלא.

### Open questions
נדרש להכריע במפרט את אלגוריתם displayed-score smoothing ואת ממד recommendation (`sync` או `total`) לפני חיבור אוטומטי מלא למעטפת. לאחר מכן: Operator/Report integration, late-data correction/persistence, Influx adapter ו־load campaign.

---


---

## Current-head supersession — 18/09/2026

הסעיף הזה גובר על ניסוחים היסטוריים קודמים כאשר הם מתארים מצב שהיה נכון בזמן milestone ישן אך אינו current-state.

### Thresholds and algorithm rationale

`ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json` הוא מקור machine-checked לברירות המחדל הפעילות של `CoreConfig`, `LivePollConfig` ו-`EventAlertConfig`. לכל threshold נשמרים:
- הערך הפעיל בקוד;
- classification מפורש: `product`, `calibration`, `implementation_guard` או `compatibility`;
- rationale הנדסי;
- source symbol בקוד.

`test_threshold_catalog.py` דורש התאמה מדויקת בין כל שדות הקונפיגורציה הפעילים לקטלוג, ולכן הוספה/שינוי של threshold בקוד בלי עדכון התיעוד נכשלת ב-CI. אותו catalog כולל גם החלטות אלגוריתמיות, alternatives ו-evidence paths אמיתיים.

### SI/SO operational runtime

המצב הפעיל אינו עוד SO-only. SI ו-SO הם first-class sibling runtime families תחת `FamilyRuntimeHost` ו-factory ניטרלי למשפחה. לשתיהן אותו ingest/session host, checkpoint envelope, restore/session-replacement ונתיב publication אטומי; ההבדלים נשארים באלגוריתם המשפחתי.

SI template עובר מקצה לקצה Web → Workspace → operational config → Python config/parser → `LiveSIRuntimeProducer` → SI scoring → RuntimeSnapshot. regression ייעודי מוכיח ששינוי template מ-120° ל-90° משנה score חי ולא רק ציור.

### Displayed score

הניסוח במחקר 13 שלפיו smoothing טרם הוגדר מתאר את מצב אותו milestone בלבד. ב-current-head קיימת שכבת display-only trailing smoothing ב-`lib/display-score-smoothing.ts` עם RAW/5/10/20/30 שניות וברירת מחדל 10 שניות. אותה תוצאה מוצגת בגרף ובכרטיסי הקבוצה לאחר recompute. raw Core score, alerts, events ו-grouping אינם צורכים את הערך המוחלק. `BW-SYNC-013` נשאר partial רק משום שנדרש user visual re-verification.

### Latency evidence

`BW-DATA-010` נמדד ב-CI מול InfluxDB2 2.7 אמיתי: Flux query → temporal join → Core → scoring/publication → RuntimeSnapshot → HTTP. run current-head הייעודי הוא #75, וה-gate נשאר <10s. Reader מדומה אינו נחשב acceptance evidence לסעיף זה.

### Historical validation snapshot (superseded by the refresh below)

At that milestone the validated head was `3c76d8bda4526ec7e36d7cbb3d3d4737ec6628a2`.
`Blue Wolf CI #2163` — SUCCESS. גם SI Live Runtime #263, Operator #682, BW-OFF-010 #587, BW-DATA-010 #75, BW-OFF-009 #549 ו-BW-OFF-012 #571 עברו SUCCESS על אותו SHA.



### Current implementation validation refresh — 18/09/2026

ה־implementation fingerprint הנוכחי לאחר סגירת `BW-DOC-003`, `BW-DOC-005`, `CFG-01` ו-`BW-UI-013` הוא `2a1cf45a2e94af2e` עבור 240 קבצי implementation תחת App/Core/Runtime/Deploy. baseline הקוד המאומת הוא `8e859273560d61af09095352579f37a94c4d45b1`.

אימות exact-head:
- `Blue Wolf CI #2203` — SUCCESS.
- `SI Live Runtime #303`, `Operator #722`, `OP-02 #710`, `OP-03 #763`, `UI/PDF #969`, `WKT #1056` — SUCCESS.
- `BW-DATA-010 #90`, `IN-01 #820`, `BW-OFF-009 #589`, `BW-OFF-010 #627`, `BW-OFF-012 #611`, `BW-CORE-009 #96`, `REP-02 #905`, `REP-03/04 #882` — SUCCESS.

ה־threshold catalog נשאר machine-checked מול הקונפיגורציה הפעילה. `CFG-01` מוסיף לכל metric/threshold המחשה של היבט התנועה/גאומטריה, current value, השפעה על score וסיווג product/calibration. `BW-UI-013` משתמש ב-legend משותף וקומפקטי ל-LIVE/SIM עם שלושה score zones וסגנונות קו רק לשכבות פעילות.

`docs/documentation-sync.json` מקשר בין fingerprint המימוש, Master Specification ב-Google Drive ודוחות המחקר. Release gate מחשב מחדש את fingerprint ולכן שינוי משמעותי ב-`app/`, `components/`, `lib/`, `core/src/`, `deploy/`, `package.json` או `next.config.ts` מחייב refresh מפורש של תיעוד לפני פרסום.

## Current implementation validation refresh — 25/09/2026

ה־baseline התיעודי הפעיל הוא `11b0caa84d67def74dee4dfe0bbcc9d670cc247c`, עם fingerprint `3c86673cc730f6ba` על 271 קבצי implementation לפי אותם tracked paths של `BW-GOV-010`. ה־Master v2.8 וה־Core Research v1.2 המקוריים ב־Drive עודכנו באופן תוכני ונקראו חזרה לפני שינוי ה־manifest; אין כאן עדכון fingerprint לצורך העברת CI בלבד.

ב־current head חוזה הציון מפריד בין `rawTotal` של אותו selected-template Core scoring pass לבין `total` החי שעובר חלון Core של 10 שניות ומשמש Event/Alert. החלקת Web היא display-only ופועלת על `rawTotal` בלבד; archive/recompute שומר provenance מפורש, וב־recompute תקף `group.total == group.rawTotal` משום שאין שם EventAlert display window. TEST navigation נשאר מסומן `simulation/syntheticNavigation=true` עד Web/PDF ואינו נהפך לראיית Influx תפעולית.

ראיות scoped עד הסנכרון: `BW-SYNC-013 Raw Score Contract #17` מכסה Core+Web raw/provenance; `Navigation Input Integration #146` עבר בשלושה שרתים דרך raw TEST navigation → temporal join → Python Core SI+SO → runtime/archive → recompute HTTP. `Blue Wolf CI #2949` עבר SUCCESS על ה־post-sync head `ebb1265e179f301372e945cb1aec138bf90a71c1`, לאחר readback של שני מסמכי ה־Drive וסגירת `BW-GOV-010`. באותו head גם `Navigation Input Integration #150` ו־`BW-SYNC-013 Raw Score Contract #18` עברו SUCCESS. זה מאמת את חוזי הקוד/תיעוד וה־TEST E2E המתועדים, אך אינו מהווה אישור production או customer Influx E2E.

## כלל עדכון מעכשיו

כל שינוי אלגוריתמי חדש חייב להוסיף/לעדכן כאן entry באותו commit או ב־documentation commit הצמוד ל־milestone המאומת. דוח ה־Word יישאר גרסה קריאה ומעוצבת של אותו בסיס מחקרי ויעודכן לאחר milestone משמעותי.

## Late-data evidence snapshot guard — 25/09/2026

ב־commit `907c4af7a9ecad94a724f3059d0afa13af395239` נוסף versioning אטומי לראיות event-recompute. `read_event_snapshot` מחזיר את ה־frames ואת `evidenceVersion`, שהוא SHA-256 דטרמיניסטי של `event_id` ושל הרצף המסודר `(sample_time_utc, payload_hash)`. מסלול ה־HTTP מחזיר ושומר את הגרסה הזו.

`record_recompute(..., expected_evidence_version=...)` פותח `BEGIN IMMEDIATE`, מחשב מחדש את גרסת הראיות מתוך SQLite ומשווה לגרסה שעליה חושב ה־recompute. אם frame מאוחר נוסף בין הקריאה לשמירה, התוצאה נדחית ב־fail-closed ואינה נשמרת. regression ב־`test_event_recompute.py` מוכיח stale rejection ולאחר מכן recompute חדש עם `frameCount` מעודכן; `Navigation Input Integration #154` מוכיח שה־HTTP מחזיר evidenceVersion תקין במסלול שלושה שרתים.

ה־implementation fingerprint לאחר השינוי הוא `e38d6e14a2b9ae28` עבור 271 קבצים. `BW-SYNC-013 #21` ו־`Navigation #154` עברו SUCCESS. `Blue Wolf CI #2953` סיים 29/30 jobs ירוקים; הכשל היחיד היה Web בגלל fingerprint התיעוד הישן, ולכן נדרש post-sync CI חדש.