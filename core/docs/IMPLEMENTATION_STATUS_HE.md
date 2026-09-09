# מצב מימוש — הליבה האלגוריתמית

## התשובה הקצרה

הליבה האלגוריתמית נמצאת כעת על baseline מאומת הכולל רכישת נתיב אדפטיבית, החלפת נתיב אדפטיבית, סיווג SI/SO/Figure-8/Double Hippodrome, קיבוץ מבני יציב, semantic phase, מודל SO מנורמל, template fit, template bank, template selection, live SO scoring, Double active-lobe / role switching ו־Event/Alert + Template Recommendation lifecycle.

Baseline מאומת לפני commits תיעודיים:

`spec-conformant-vector-core @ f9442f0716c37b5cf6f96bc778bec745eaad7eef`

`Blue Wolf CI` run `652` עבר במלואו, כולל shard ייעודי `event-alert`, כל shards של route lifecycle/grouping/SO, ו־Web.

העיקרון המחייב לרכישת/שינוי Route הוא `ADAPTIVE_ROUTE_LIFECYCLE_HE.md`: זמן שחלף אינו ראיה. 40 דקות הן תקרת history בלבד ולא זמן המתנה.

`DOUBLE_HIPPODROME_SCORING_SEMANTICS_HE.md` קובע את משמעות ה־Double לצורך synchronization: נתיב פיזי רציף אחד, שני Hippodromes לוגיים לציון, active-lobe semantic phase והחלפת roles ללא תלות ב־vehicle ID.

`EVENT_ALERT_LIFECYCLE_HE.md` קובע את הפרדת event/alert/recommendation מ־route detection, grouping ו־active template selection.

## אבן דרך 1 — חוזי ליבה, גאומטריה וציון בסיסי — הושלמה

- חוזי קלט/פלט גרסאיים של הליבה.
- `VehicleSample`, `ClosedRoute`, `VehicleFrameResult`, ציוני רכב וקבוצה.
- ייצוג גנרי לנתיב סגור עם canonical polyline עד 64 נקודות.
- גאומטריית פאזה לפי אורך קשת, projection, tangent ו־curvature.
- משקולות וספי ציון מאושרים.
- ציון קבוצה נגזר מציוני הרכבים התקפים בלבד; אין נוסחת קבוצה עצמאית.
- checkpoint ושקילות Batch/Incremental כעקרון תכן.
- Join זמני בסיסי למטריקות Influx נפרדות ללא `TTAG`.

## אבן דרך 2 — סימולטור גאומטרי/הפרעות — הושלמה עבור הצורות המוגדרות

הסימולטור הדטרמיניסטי תומך ב־Ground Truth `approach/route/exit` ובמשפחות:

- SI Circle.
- SI Octagon.
- SI Free Closed.
- SO Hippodrome.
- SO Figure-8 עם legs שיכולים להיות רכים.
- SO Double Hippodrome לפי exterior boundary של union של שני capsule/hippodrome areas בעלי shared turn-circle center.

תרחישי הפרעה כוללים cadence של 1/2/5 שניות, GPS Gaussian noise ו־spikes, רוח משתנה, base dropout, turn-dependent dropout, contiguous outages, approach/exit ו־sweep של Double opening angle. הטווח 10°–40° הוא QA priority בלבד ואינו gate של detector.

`DOUBLE_FIGURE_EIGHT` נשאר Undefined גאומטרית ואסור לממש אותו ללא אפיון מפורש נוסף.

## אבן דרך 3 — Vectorized automatic route detection V2 — הושלמה

- `VehicleSample` מותאם ל־`VectorTrack` אחיד עם `observed_mask` מפורש.
- אין interpolation של מיקום לתוך חורי תקשורת לצורך evidence.
- masked spatial recurrence מחושב באמצעות FFT correlations בעלות `O(N log N)` במקום מטריצת `N×N`.
- period proposal עובר local lag refinement קטן וחסום.
- periodic support סובל jitter וחוסר דגימות.
- velocity consistency אופציונלית מונעת approach crossing שווא.
- phase folding מפיק canonical centerline ו־support/count לכל phase bin.
- Coverage הוא circular phase coverage ואינו תלוי ישירות ב־cadence.
- confirmed geometry משתמשת בכל observations האמיתיים בתוך recurrent traversal span.
- מרכז וצירים נגזרים ממעטפת מרחבית רובוסטית.

ממומשים ומכוסים ברגרסיות: SI compact, Single Hippodrome, Figure-8, Double Hippodrome ו־Free/Unknown.

## אבן דרך 4 — Adaptive route lifecycle — הושלמה

### Route acquisition

- אין timer קבוע של 5 דקות.
- partial candidate הוא topology-neutral evidence.
- Confirmation מבוסס fit, coverage, cycle travel ו־closure.
- geometric re-observation + adaptive suffix search + refinement.
- approach יכול להישאר ב־buffer בלי לקבל attribution למסלול.

### Route replacement

- Route מאושר אינו ננעל.
- cheap suspicion gate מונע fit יקר כשהישן עדיין מסביר את הדגימה.
- שינוי חומרי מכויל סביב 20% geometry/period לצד family/subtype/topology/direction.
- אין timer קבוע של 120 שניות לשינוי.
- replacement דורש evidence purity שמעדיף B על A.
- period-only replacement משתמש ב־observed speed ודורש רוב ברור של המשטר החדש.
- onset מיוחס רטרואקטיבית; `detection_time_utc` נשמר בנפרד.
- checkpoint באמצע A→B שקול לריצה רציפה.

## אבן דרך 5 — Structural Grouping V2 — הושלמה

Membership תלוי רק ב־geometry + period + reliability/lifecycle; synchronization score אינו משפיע על membership.

- SI משתמש complete-link.
- SO משתמש connected structural chain.
- Single/Double period comparison משתמש base period normalization כאשר נדרש.
- membership evidence של 120s נמדד מתוך המידע שכבר נאסף.
- `group_id` נשמר ב־60% overlap; merge יוצר ID חדש.
- membership hold הוא 300s.
- SI wrong-direction: alert לאחר 60s; removal רק לאחר 300s נוספים; היפוך משותף אינו מפרק את הקבוצה.
- Batch/Incremental/checkpoint equivalence מכוסה.

## אבן דרך 6 — Semantic Phase ו־SO normalized templates — הושלמה

### Semantic phase

- `VehicleFrameResult.phase` נשאר raw/legacy phase.
- נוסף `semantic_phase` עבור SO.
- frame גאומטרי קנוני מסיר raw phase-zero ו־polyline ordering differences.
- Route Instances מיושרים באמצעות projective mean של major-axis orientations.
- Figure-8 משתמש heading-aware branch selection; ללא evidence מספיק `semantic_phase=None`.

### מודל SO מנורמל

`SO Template -> Route Instances -> Vehicle Slots -> Quarter`

- `Single` עד שני Vehicle Slots; `Double` עד ארבעה.
- `Q0/Q1/Q2/Q3`.
- Same/Opposite/Mixed נגזרים מהפרש quarters.
- vehicle geometry/profile מופרד מסמנטיקת התבנית.
- Figure-8 ממופה ל־Single-SO semantics.
- Double Figure-8 נדחה במפורש כ־Undefined.

### Template fit / bank / selection

- template fit אינו תלוי ב־vehicle ID.
- assignment מתבצע לפי Route Instance + vehicle type + semantic phase.
- common phase/tie-break דטרמיניסטיים.
- `SOTemplateBank` מסנן לפי constellation ללא vehicle IDs.
- manual selection נשמר לפי `group_id + constellation`, default מגיע מן הבנק, ו־stale selection נפסל במפורש בשינוי bank.

## אבן דרך 7 — Double Hippodrome active-lobe / role switching — הושלמה ומאומתת

- full physical Double נשאר Route אחד ל־recurrence/full period/lifecycle.
- synchronization רואה שני logical Single-Hippodrome scoring surfaces.
- `active_so_component_id` נבחר לפי position ו־velocity/tangent כאשר החיבור עמום.
- `semantic_phase` של Double מחושב על active lobe.
- אין role/semantic phase מומצא כשאין evidence מספיק.
- roles אינם נשמרים לפי vehicle ID.
- רכיבי ה־Double הם derived geometry דטרמיניסטי.

## אבן דרך 8 — Live SO scoring + Event/Alert lifecycle — הושלמה ומאומתת

### Live SO scoring

- `LiveSOMetricsEngine` מחשב period/movement/route primitives ללא נוסחת score חלופית.
- temporal derivative אינו מחבר בין Double lobes; lobe switch מאפס warmup לאותה דגימה.
- excessive gap או phase step לא מזוהה מאפסים derivative state במקום להמציא תנועה.
- `LiveSOGroupScorer` משתמש ב־active template מן registry ומעביר את התצפיות ל־`score_so_template`.
- state של temporal metrics ושל template selection נשמר ב־checkpoint.

### Event / Alert / Recommendation

- אירוע נפתח לפי `group_id + context_key`; ירידת score לבדה אינה פותחת אירוע חדש.
- low-score alert נפתח אחרי 10s מתחת ל־50 ונסגר אחרי 20s ב־60 ומעלה.
- recommendation נפתחת רק לאחר יתרון 30 נקודות במשך 120s ונפסקת לאחר יתרון קטן מ־15 במשך 30s.
- rejection נשמר עד סוף האירוע בלבד.
- recommendation לעולם אינה מחליפה active template אוטומטית.
- event finalization נדחה ב־120s לפי V1.
- checkpoint משמר alert/recommendation streaks ולכן restart אינו מאפס evidence.
- נוסף `EVENT_ALERT_LIFECYCLE_HE.md` ו־11 regressions ב־`test_event_alert`.

Baseline `f9442f0716c37b5cf6f96bc778bec745eaad7eef` עבר `Blue Wolf CI` run `652` במלואו.

## מצב CI ואימות

ה־workflow כולל `cancel-in-progress` ו־shards מקבילים. בין השערים הפעילים:

- lifecycle smokes: fast acquisition, free-approach attribution, initial confirmation geometry, stable route, geometry replacement, period replacement.
- route-change remainder.
- session / integrated-session / semantic-session.
- classifiers / route-vector / fundamentals.
- SO templates / template fit / phase / scoring / template bank / template selection / live SO scoring.
- Double active-lobe.
- event-alert.
- Web: lint, TypeScript, tests.

כשל אלגוריתמי שהתגלה הופך ל־regression קבוע לפני קידום baseline.

### ביצועים

לאחר הוספת cheap route-suspicion gate, חבילת 60 בדיקות ליבה ירדה באחת מריצות ה־CI מכ־183.3s לכ־58.7s ללא regression. זהו נתון תצפית CI ולא benchmark פורמלי. מאז הורחבה החבילה וחולקה ל־shards מקבילים.

## תיעוד מחקר

`ALGORITHMIC_CORE_RESEARCH_LOG_HE.md` הוא יומן version-controlled לכל `Problem -> Hypothesis -> Experiment -> Result -> Change -> Regression -> Validation`.

בנוסף מופק דוח Word מחקרי מעוצב. milestone אלגוריתמי משמעותי מתועד גם ביומן הריפו וגם בגרסה הבאה של הדוח.

## אבני הדרך הבאות

1. **Runtime composition end-to-end** — בניית `context_key`, חיבור `Route -> Group -> Semantic phase -> Template -> Metrics -> Vehicle/Group scores -> Event/Alert` בזרם אחד, כולל scoring של alternate templates מאותו metric snapshot ללא עדכון temporal state כפול.
2. **Late-data correction + local persistence** ושחזור גרסאות חישוב.
3. **InfluxDB2 adapter** ומצב polling awake/sleep.
4. חיבור Python Core האמיתי לכל זרימות Operator/Report/Developer ב־Web במקום שכבות demo.
5. load/robustness campaign פורמלי עד סדר גודל של 10 שרתים / 150 כלי רכב.
6. Windows/OpenShift packaging ו־release/preview מאומת.

`DOUBLE_FIGURE_EIGHT` אינו milestone לביצוע עד שגאומטרייתו תוגדר מפורשות באיפיון.