# זאב כחול — Runtime חי ל־SO: Scoring, חלופות, Events ו־Recommendations

מסמך זה מקבע את שכבת החיבור `LiveSOEventRuntime` שנוספה לאחר השלמת `LiveSOGroupScorer` ו־`EventAlertEngine`. מטרתה לחבר את הזרם החי בלי לשכפל temporal evidence ובלי להמציא החלטות מוצר שאינן מוגדרות ב־V1.

## 1. צינור העיבוד

לכל snapshot של קבוצת SO:

`Members -> LiveSOMetricsEngine -> active template score -> alternate template scores -> EventAlertEngine`

העיקרון המחייב הוא ש־`LiveSOMetricsEngine` מתקדם פעם אחת בלבד לכל member/timestamp. לאחר מכן כל התבניות החלופיות מקבלות את אותן `SOScoringObservation` immutable שכבר הופקו עבור התבנית הפעילה.

כך recommendation evaluation אינו משנה phase-rate, curvature history או warmup state, ואינו יכול לייצר התנהגות שונה רק בגלל מספר התבניות בבנק.

## 2. תבנית פעילה ותבניות חלופיות

- התבנית הפעילה מגיעה רק מ־`SOTemplateSelectionRegistry`.
- החלופות מגיעות רק מ־`SOTemplateBank.relevant_templates(constellation)`.
- כל חלופה נבחנת באמצעות `score_so_template()` הקיים; אין נוסחת score חדשה.
- חלופה שאינה חוקית עבור ה־Route Instance binding הנוכחי אינה recommendation candidate.
- evaluation של חלופה אינו משנה active selection ואינו משנה group membership.

## 3. Event context

`build_so_event_context_key()` בונה digest דטרמיניסטי מ־constellation, active template identity ו־route identity/geometry-period metadata של חברי הקבוצה.

ה־context כולל בין היתר:

- `route_id`, family, subtype ו־topology.
- `route_instance_id` ו־vehicle type.
- period ו־length של הנתיב המאושר.
- active template id.

ה־context אינו כולל semantic phase רגעי, quarter רגעי או active Double lobe. לכן התקדמות תקינה סביב המסלול ומעבר טבעי בין lobes אינם פותחים אירוע חדש, בעוד route replacement או שינוי template פעיל כן משנים context.

## 4. שתי החלטות שנשארות מפורשות

### 4.1 Displayed score

`V1_SPEC_HE.md` קובע שההתראה פועלת על הציון המוצג והמוחלק, אך אינו מגדיר אלגוריתם smoothing מלא. לכן ה־runtime אינו מחליף אותו ב־raw group score. ה־caller חייב לספק:

- `displayed_group_score`
- `displayed_score_valid`

כך לא נוצרת סמנטיקה חדשה בשכבת הליבה.

### 4.2 ממד השוואת תבניות

V1 קובע שחלופה צריכה להיות טובה ב־30 נקודות ל־120 שניות, אך אינו מציין במפורש אם ההשוואה היא לפי `sync` או `total`. לכן אין default שקט. ה־runtime דורש `TemplateComparisonDimension` מפורש:

- `SYNC`
- `TOTAL`

עד להכרעת מוצר, שתי האפשרויות נתמכות והבחירה נשמרת ב־checkpoint.

## 5. Checkpoint

`export_state()` שומר יחד:

- template selection registry.
- temporal metric state.
- comparison dimension.
- Event/Alert/Recommendation state.

`from_state()` משחזר את כל השכבות ומחזיר גם manual selections שנפסלו עקב שינוי template bank.

## 6. Regressions

נוספו 5 regressions ייעודיים ב־`test_live_so_event_runtime.py`:

1. alternate scoring משתמש באותו temporal snapshot ואינו מקדם `dt` פעמיים.
2. recommendation נפתחת לאחר 120 שניות של יתרון רציף של אותה חלופה.
3. context יציב בזמן progress רגיל ומשתנה כאשר active template משתנה.
4. checkpoint באמצע recommendation streak שומר את זמן תחילת ה־evidence.
5. raw score אינו מחליף displayed/smoothed score כאשר שכבת המוצר עדיין לא סיפקה אותו.

## 7. Validation

Baseline מאומת:

`spec-conformant-vector-core @ 7b938ca87747031ab299500ec55c33ebc11c4f50`

`Blue Wolf CI` run `659` — `success`.

הריצה כללה את shard `live-so-event-runtime`, את כל route/grouping/SO regressions ואת Web application (`lint`, TypeScript ו־tests).

## 8. המשך

החסם הבא אינו עוד composition פנימי של SO. השלבים הבאים הם:

- הכרעת מוצר על smoothing ועל ממד recommendation (`sync` מול `total`).
- חיבור runtime זה ל־session/operator pipeline המבצעי ול־UI במקום שכבות demo.
- late-data correction ו־local persistence עם versioned recomputation.
- InfluxDB2 adapter ומצב awake/sleep.
- load/robustness campaign בקנה המידה המבצעי.
