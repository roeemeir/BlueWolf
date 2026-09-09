# מצב מימוש — הליבה האלגוריתמית

## התשובה הקצרה

הליבה האלגוריתמית נמצאת כעת על baseline מאומת הכולל רכישת והחלפת נתיב אדפטיביות, סיווג SI/SO/Figure-8/Double Hippodrome, קיבוץ מבני יציב, semantic phase, מודל SO מנורמל, template fit/bank/selection, live SO scoring, Double active-lobe / role switching, Event/Alert + Template Recommendation lifecycle, ו־runtime composition שמחבר scoring פעיל וחלופי ל־Event Engine בלי לקדם temporal evidence פעמיים.

Baseline מאומת לפני commits תיעודיים:

`spec-conformant-vector-core @ 7b938ca87747031ab299500ec55c33ebc11c4f50`

`Blue Wolf CI` run `659` עבר במלואו, כולל shard ייעודי `live-so-event-runtime`, כל shards של route lifecycle/grouping/SO, ו־Web (`lint`, TypeScript ו־tests).

המסמכים המחייבים המרכזיים הם:

- `ADAPTIVE_ROUTE_LIFECYCLE_HE.md` — זמן שחלף אינו evidence; 40 דקות הן תקרת history בלבד.
- `DOUBLE_HIPPODROME_SCORING_SEMANTICS_HE.md` — Double הוא Route פיזי רציף עם active-lobe semantic phase לציון.
- `TEMPLATE_SELECTION_LIFECYCLE_HE.md` — selection ו־recommendation הם שכבות נפרדות.
- `EVENT_ALERT_LIFECYCLE_HE.md` — event/alert/recommendation אינם משנים route/group membership.
- `LIVE_SO_EVENT_RUNTIME_HE.md` — composition של metric snapshot יחיד לתבנית פעילה, חלופות ו־Event Engine.

## אבן דרך 1 — חוזי ליבה, גאומטריה וציון בסיסי — הושלמה

- חוזי קלט/פלט גרסאיים של הליבה.
- `VehicleSample`, `ClosedRoute`, `VehicleFrameResult`, ציוני רכב וקבוצה.
- ייצוג גנרי לנתיב סגור עם canonical polyline עד 64 נקודות.
- גאומטריית פאזה לפי אורך קשת, projection, tangent ו־curvature.
- משקולות וספי ציון מאושרים.
- ציון קבוצה נגזר מציוני הרכבים התקפים בלבד.
- checkpoint ושקילות Batch/Incremental כעקרון תכן.
- Join זמני בסיסי למטריקות Influx נפרדות ללא `TTAG`.

## אבן דרך 2 — סימולטור גאומטרי/הפרעות — הושלמה עבור הצורות המוגדרות

הסימולטור הדטרמיניסטי תומך ב־Ground Truth `approach/route/exit` ובמשפחות SI Circle/Octagon/Free Closed, SO Hippodrome, Figure-8 ו־Double Hippodrome. תרחישי ההפרעה כוללים cadence של 1/2/5 שניות, GPS noise/spikes, רוח, dropout רגיל ותלוי־פנייה, contiguous outages ו־approach/exit. זוויות Double של 10°–40° הן QA priority ולא detector gate.

`DOUBLE_FIGURE_EIGHT` נשאר Undefined ואסור לממש אותו ללא אפיון מפורש נוסף.

## אבן דרך 3 — Vectorized automatic route detection V2 — הושלמה

- `VectorTrack` עם `observed_mask` מפורש; אין השלמת מיקום לתוך חורי תקשורת לצורך evidence.
- masked spatial recurrence באמצעות FFT correlations בעלות `O(N log N)` במקום מטריצת `N×N`.
- local lag refinement, periodic support עם jitter ו־heading consistency אופציונלי.
- phase folding ו־circular phase coverage שאינו תלוי ישירות ב־cadence.
- confirmed geometry מכל observations האמיתיים בתוך recurrent traversal span.
- מעטפת מרחבית רובוסטית למרכז וצירים.
- SI compact, Single Hippodrome, Figure-8, Double Hippodrome ו־Free/Unknown מכוסים ברגרסיות.

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
- שינוי חומרי נבחן סביב 20% geometry/period לצד family/subtype/topology/direction.
- אין timer קבוע של 120 שניות לשינוי.
- replacement דורש evidence purity שמעדיף B על A.
- period-only replacement דורש רוב ברור של משטר המהירות החדש.
- onset מיוחס רטרואקטיבית ו־`detection_time_utc` נשמר בנפרד.
- checkpoint באמצע A→B שקול לריצה רציפה.

## אבן דרך 5 — Structural Grouping V2 — הושלמה

Membership תלוי רק ב־geometry + period + reliability/lifecycle; synchronization score אינו משפיע על membership.

- SI משתמש complete-link; SO משתמש connected structural chain.
- Single/Double period comparison משתמש base-period normalization כאשר נדרש.
- membership evidence של 120s נמדד מתוך המידע שכבר נאסף.
- `group_id` נשמר ב־60% overlap; merge יוצר ID חדש.
- membership hold הוא 300s.
- SI wrong-direction: alert לאחר 60s; removal רק לאחר 300s נוספים; היפוך משותף אינו מפרק קבוצה.
- Batch/Incremental/checkpoint equivalence מכוסה.

## אבן דרך 6 — Semantic Phase ותבניות SO — הושלמה

- `VehicleFrameResult.phase` נשאר raw/legacy; נוסף `semantic_phase` ל־SO.
- frame גאומטרי קנוני מסיר phase-zero ו־polyline-order differences.
- Figure-8 משתמש heading-aware branch selection; ללא evidence מספיק אין semantic phase מומצא.
- מודל התבנית: `SO Template -> Route Instances -> Vehicle Slots -> Quarter`.
- Single עד 2 slots; Double עד 4; Q0/Q1/Q2/Q3; Same/Opposite/Mixed נגזרים מן quarters.
- template fit אינו תלוי ב־vehicle ID.
- `SOTemplateBank` מסנן לפי constellation; manual selection נשמר לפי `group_id + constellation`.

## אבן דרך 7 — Double Hippodrome active-lobe / role switching — הושלמה ומאומתת

- full physical Double נשאר Route אחד ל־recurrence/full period/lifecycle.
- synchronization רואה שני logical Single-Hippodrome scoring surfaces.
- `active_so_component_id` נבחר לפי position, ובחיבור עמום לפי velocity/tangent.
- semantic phase מחושב על ה־active lobe.
- אין role/semantic phase מומצא כאשר evidence אינו מספיק.
- roles אינם נשמרים לפי vehicle ID.

## אבן דרך 8 — Live SO scoring + Event/Alert lifecycle — הושלמה ומאומתת

### Live SO scoring

- `LiveSOMetricsEngine` מחשב period/movement/route primitives ללא נוסחת score מקבילה.
- Double lobe switch, temporal gap או phase ambiguity מאפסים derivative state במקום לפברק תנועה.
- `LiveSOGroupScorer` משתמש ב־active template מן registry ומעביר ל־`score_so_template`.
- metric state + template selection checkpointable.

### Event / Alert / Recommendation

- event לפי `group_id + context_key`; ירידת score לבדה אינה פותחת event חדש.
- low-score alert: 10s מתחת ל־50; recovery: 20s ב־60 ומעלה.
- recommendation: יתרון 30 נקודות ל־120s; סגירה כאשר היתרון קטן מ־15 ל־30s.
- rejection עד סוף האירוע; אין החלפת template אוטומטית.
- event finalization לאחר 120s.
- checkpoint שומר alert/recommendation streaks.

## אבן דרך 9 — Live SO Event Runtime composition — הושלמה ומאומתת

נוסף `LiveSOEventRuntime` כדי לחבר את השכבות הקיימות לזרם דטרמיניסטי אחד:

`SO members -> temporal metrics -> active template score -> alternate template scores -> EventAlertEngine`

העקרונות שננעלו:

- `LiveSOMetricsEngine` מתקדם פעם אחת בלבד לכל member/timestamp.
- כל החלופות מנוקדות מאותו immutable `SOScoringObservation` snapshot; מספר התבניות בבנק אינו משנה temporal state.
- `context_key` נגזר מ־constellation, active template ו־confirmed route identity/geometry-period metadata; progress רגיל ו־Double lobe switching אינם פותחים event חדש.
- active template מגיע רק מ־`SOTemplateSelectionRegistry`; recommendation אינה משנה selection.
- displayed/smoothed group score מוזן מבחוץ כי V1 אינו מגדיר את אלגוריתם smoothing.
- ממד comparison של recommendation (`SYNC` או `TOTAL`) חייב להיות מפורש כי V1 אינו מגדיר איזו מן השתיים היא “30 נקודות טוב יותר”. אין default שקט.
- checkpoint משמר comparison dimension, scorer state ו־Event Engine state.

נוספו 5 regressions ב־`test_live_so_event_runtime`: reuse של temporal snapshot, recommendation אחרי 120s, context stability/change, checkpoint באמצע streak, ואיסור להחליף displayed score ב־raw score.

Baseline `7b938ca87747031ab299500ec55c33ebc11c4f50` עבר `Blue Wolf CI` run `659` במלואו.

## מצב CI ואימות

ה־workflow כולל `cancel-in-progress` ו־shards מקבילים. השערים הפעילים כוללים lifecycle smokes, route-change remainder, session/integrated/semantic sessions, classifiers/route-vector/fundamentals, כל שכבות SO, `event-alert`, `live-so-event-runtime`, ו־Web (`lint`, TypeScript, tests).

כשל אלגוריתמי שהתגלה הופך ל־regression קבוע לפני קידום baseline.

## תיעוד מחקר

`ALGORITHMIC_CORE_RESEARCH_LOG_HE.md` הוא יומן version-controlled לכל `Problem -> Hypothesis -> Experiment -> Result -> Change -> Regression -> Validation`. בנוסף נשמר דוח Word מחקרי מעוצב ב־Drive ומסונכרן לאחר milestones משמעותיים.

## אבני הדרך הבאות

1. **Product decisions / smoothing contract** — לקבע במפרט את אלגוריתם ה־10s displayed smoothing ואת ממד recommendation (`sync` מול `total`) לפני חיבור אוטומטי מלא למעטפת.
2. **Session/Operator integration** — לחבר את Python Core האמיתי ל־Operator/Report/Developer flows במקום שכבות demo, כולל event context ו־alerts בפועל.
3. **Late-data correction + local persistence** — versioned recomputation, SQLite/Parquet ו־checkpoint operational.
4. **InfluxDB2 adapter** — polling awake/sleep, late fetch, tokens ומיפוי streams.
5. **Load/robustness campaign** — עד סדר גודל של 10 שרתים / 150 כלי רכב.
6. **Windows/OpenShift packaging + Sites demo release** — הפריסה הציבורית נשארת הדגמה ואינה מחליפה את השירות המבצעי ברשת הסגורה.

`DOUBLE_FIGURE_EIGHT` אינו milestone לביצוע עד שגאומטרייתו תוגדר מפורשות באיפיון.