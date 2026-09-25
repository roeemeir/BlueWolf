# מצב מימוש — Blue Wolf Core + Operational Runtime

## התשובה הקצרה

הפרויקט כבר אינו ליבה אלגוריתמית מבודדת. השרשרת הפעילה היא:

`InfluxDB2 -> temporal join -> adaptive CoreSession -> structural grouping -> family-neutral runtime host -> SI/SO live scoring -> Event/Alert runtime -> RuntimeSnapshot -> Operator`

לצידה קיימים safe polling/watermark, rollback לאחר poll כושל, checkpoint/restart continuity, SQLite persistence/migrations, ASGI runtime service, Windows/OpenShift packaging, WMTS secret-backed map pipeline ו-live history ל-Operator.

**כלל baseline:** מסמך זה אינו מקבע SHA ידני שעלול להתיישן. ה-baseline המחייב הוא ה-current-head שמופיע ב-Full Spec וב-current-head audit של ה-registry, ורק run מלא שאינו cancelled נחשב evidence. Release נשאר חסום עד implementationApproval מפורש של המשתמש במקומות שנדרשים.

**חוזה תיעוד אלגוריתמי:** `ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json` מכסה machine-readably את כל defaults של `CoreConfig`, `LivePollConfig` ו-`EventAlertConfig`, כולל סיווג ורציונל; `test_threshold_catalog.py` מפיל CI אם הקוד והתיעוד נסחפים זה מזה. ערכי legacy שנשמרים רק לתאימות מסומנים במפורש ואינם מוצגים כ-gates פעילים.
## מסמכי מקור מרכזיים

- `ADAPTIVE_ROUTE_LIFECYCLE_HE.md` — זמן שחלף אינו evidence; 40 דקות הן memory ceiling בלבד.
- `AUTOMATIC_ROUTE_DETECTION_V2_HE.md` — vectorized recurrence / phase coverage / route detection.
- `DOUBLE_HIPPODROME_SCORING_SEMANTICS_HE.md` — Double כנתיב רציף עם active-lobe scoring semantics.
- `TEMPLATE_SELECTION_LIFECYCLE_HE.md` — selection ו־recommendation הן שכבות נפרדות.
- `EVENT_ALERT_LIFECYCLE_HE.md` — event/alert/recommendation lifecycle.
- `LIVE_SO_EVENT_RUNTIME_HE.md` — composition של active/alternate scoring ל־Event Engine.
- `LIVE_RUNTIME_CONTRACT_HE.md` — החוזה המבצעי Python Core ↔ Operator, history ו־persistence.
- `ALGORITHMIC_CORE_RESEARCH_LOG_HE.md` — יומן Problem → Hypothesis → Experiment → Result → Regression → Validation.

---

## אבן דרך 1 — חוזי ליבה, גאומטריה וציון בסיסי — הושלמה

- `VehicleSample`, `ClosedRoute`, `VehicleFrameResult`, ציוני רכב וקבוצה.
- canonical closed-route geometry עד 64 נקודות.
- projection, arc-length phase, tangent ו־curvature.
- ציוני קבוצה נגזרים רק מציוני רכבים תקפים.
- Batch/Incremental/checkpoint equivalence הוא עקרון תכן.
- temporal join למטריקות Influx נפרדות.

## אבן דרך 2 — סימולטור והפרעות — הושלמה עבור הצורות המוגדרות

Ground Truth כולל approach/route/exit עבור SI Circle/Octagon/Free Closed, SO Hippodrome, Figure-8 ו־Double Hippodrome. QA כולל cadence 1/2/5s, GPS noise/spikes, רוח, dropout רגיל ותלוי־פנייה, contiguous outages ו־approach/exit.

`DOUBLE_FIGURE_EIGHT` נשאר **Undefined** ואסור לממש אותו ללא אפיון גאומטרי מפורש.

## אבן דרך 3 — Vectorized automatic route detection V2 — הושלמה

- `VectorTrack.observed_mask` שומר חוסרי תקשורת מפורשים.
- masked spatial recurrence ב־FFT ללא מטריצת `N×N`.
- local lag refinement, periodic support ו־heading consistency אופציונלי.
- phase folding ו־circular phase coverage שאינו תלוי ישירות בצפיפות הדגימה.
- confirmed geometry מכל observations האמיתיים בתוך recurrent traversal span.
- SI compact, Single Hippodrome, Figure-8, Double Hippodrome ו־Free/Unknown מכוסים ברגרסיות.

## אבן דרך 4 — Adaptive route lifecycle — הושלמה

### Acquisition

- אין 5 דקות כתנאי לאישור.
- partial candidate הוא topology-neutral.
- confirmation מבוסס fit, coverage, travel/recurrence ו־closure.
- geometric re-observation + adaptive suffix search + refinement.
- approach יכול להישאר ב־buffer בלי attribution למסלול.

### Replacement

- route מאושר אינו ננעל.
- cheap suspicion gate לפני fit יקר.
- שינוי חומרי סביב geometry/period/family/subtype/topology/direction.
- אין 120 שניות כ־timer קבוע לשינוי.
- period-only replacement דורש רוב ברור של משטר מהירות חדש.
- onset מיוחס רטרואקטיבית; detection time נשמר בנפרד.
- checkpoint באמצע A→B שקול לריצה רציפה.

## אבן דרך 5 — Structural Grouping V2 — הושלמה

Membership תלוי ב־geometry + period + reliability/lifecycle בלבד, לא בציון הסנכרון.

- SI complete-link; SO connected structural chain.
- Single/Double period normalization כאשר נדרש.
- group identity נשמר לפי overlap; merge מייצר identity חדש.
- membership evidence/hold נשמרים ב־lifecycle state.
- SI wrong-direction lifecycle נפרד מציון הסנכרון.

## אבן דרך 6 — Semantic Phase ותבניות SO — הושלמה

- `semantic_phase` נפרד מן raw/legacy phase.
- canonical frame מסיר phase-zero/polyline-order differences.
- Figure-8 משתמש heading-aware branch selection.
- `SO Template -> Route Instances -> Vehicle Slots -> Quarter`.
- Single עד 2 slots; Double עד 4; Same/Opposite/Mixed נגזרים מן quarters.
- template fit אינו תלוי ב־vehicle ID.
- `SOTemplateBank` + manual selection לפי group/constellation.

## אבן דרך 7 — Double Hippodrome active-lobe / role switching — הושלמה

- Double נשאר route פיזי אחד ל־recurrence/full period/lifecycle.
- scoring משתמש בשני logical Single-Hippodrome surfaces.
- active component נגזר position, ובחיבור עמום velocity/tangent.
- semantic phase מחושב על ה־active lobe.
- אין role/phase מומצא כשאין evidence מספיק.

## אבן דרך 8 — Live SO scoring + Event/Alert lifecycle — הושלמה

- `LiveSOMetricsEngine` מחשב primitives ולא נוסחת score מקבילה.
- gap/lobe switch/phase ambiguity מאפס derivative state במקום לפברק תנועה.
- `LiveSOGroupScorer` משתמש ב־active template מן registry.
- low-score alert/recovery ו־Template Recommendation הם state machines נפרדים.
- recommendation אינה מחליפה template אוטומטית.
- streaks ו־selection state checkpointable.

## אבן דרך 9 — Live SO Event Runtime composition — הושלמה

`SO members -> temporal metrics -> active score -> alternate scores -> EventAlertEngine`

- temporal metrics מתקדמים פעם אחת בלבד לכל member/timestamp.
- כל החלופות משתמשות באותו immutable scoring observation.
- context key מבוסס constellation/template/confirmed route context ולא progress רגעי.
- comparison dimension הוא מפורש (`sync`/`total`).
- displayed score מוזן מבחוץ ואינו מוחלף בשקט ב־raw score.

---

## אבן דרך 10 — Versioned Operator / Python Core contract — הושלמה

נוסף application-facing package נפרד `bluewolf_runtime_adapter`; הוא משתמש בליבה אך אינו מזהם את `bluewolf_core` ב־HTTP/UI/Influx concerns.

חוזה latest:

`bluewolf.live-runtime.v1`

- serializer מפורש ל־SO runtime.
- מיקום/heading נשלחים רק אם נצפו; אין reconstruction מפאזה.
- `displayed_group_score` ו־validity מפורשים.
- משפחה חסרה נשארת unavailable.
- recommendation אינו ממציא sustained duration.
- Web normalizer דוחה wrong-server/wrong-schema payloads.
- failure של Python runtime מאפס/מבטל operational score במקום להשאיר demo score.

Web bridge:

`/api/live-runtime -> BLUEWOLF_CORE_API_URL/v1/live-runtime`

עם optional `BLUEWOLF_CORE_API_TOKEN`, `no-store` ו־timeout.

## אבן דרך 11 — InfluxDB2 operational polling + runtime service — הושלמה ומכוסה ב־CI

- InfluxDB2 adapter עם mappings מפורשים ו־token מ־environment בלבד.
- temporal window reader ו־join tolerance.
- `ServerPollCursor` עם active poll / idle probe / bootstrap history.
- awake policy מבוסס latest joined snapshot בלבד.
- poll transaction rollback-safe; session שהוחלף ב־rollback מסונכרן מחדש ל־producer לפני publish.
- server failures מבודדים: כשל בשרת אחד אינו מרעיב את האחרים.
- `OperationalLoopHost` מריץ poll loop באותו process של ה־ASGI store.
- `/healthz` ו־`/readyz` מבחינים transport-only מול operational runtime.
- JSON factory בונה templates, bindings, Influx, servers ו־polling בלי hard-code מבצעי בליבה.
- runtime image non-root ו־OpenShift/Windows packaging מכוסים ב־CI.

## אבן דרך 12 — Operational persistence + bounded checkpoint I/O — הושלמה ברמת הקוד

`bluewolf.operational-state.v1` שומר:

- CoreSession checkpoint.
- poll cursor/watermark.
- LiveSOEventRuntime state.
- producer structural state.
- latest runtime snapshot.
- live runtime history.

ה־state נכתב אטומית באותו filesystem ומוגן ב־configuration fingerprint.

לאחר זיהוי write amplification, checkpoint cadence הותאם ל־`CoreConfig.timing.checkpoint_seconds`:

- שינוי ראשון נשמר מיד.
- state נוסף נשמר לכל היותר פעם ב־300s כברירת מחדל.
- dirty state נשמר ב־shutdown לאחר עצירת thread ה־polling.
- checkpoint V1 ישן נשאר בר־שחזור.

## אבן דרך 13 — 30-minute compact operational history — הושלמה ברמת הקוד

חוזה נפרד:

`bluewolf.live-runtime-history.v1`

ה־latest נשאר snapshot מלא; history שומר רק group-score points הנדרשים לגרף.

### Retention

- 30 דקות לפי `observedAt`, לא לפי מספר samples.
- exact boundary נשמר; older point נחתך.
- out-of-order correction אינו מחליף latest.
- hard cap ברירת מחדל 2,000 points, מקסימום API 5,000.
- 1s poll × 30 דקות = 1,801 points ולכן נכנס ב־default cap.

### Web timeline

- bootstrap דרך `/api/live-runtime/history`.
- history/live race נפתר במיזוג לפי timestamp.
- dedup + same-timestamp replacement.
- gaps כאשר group/score invalid.
- event bands לפי event IDs אמיתיים.
- simulation ממשיכה להשתמש בגרף הדטרמיניסטי הישן; Influx משתמש רק ב־operational history.

### Restart migration

checkpoint חדש שומר compact points. Restore תומך גם ב־V1 ישן ששמר full live snapshots וממיר אותם בזמן טעינה; V1 ללא history עדיין משחזר latest.

### Footprint guard

נוסף `test_runtime_history_footprint.py`:

- compact point חייב להיות לפחות פי 10 קטן מ־full live snapshot מייצג של 15 רכבים.
- 10 שרתים × 30 דקות × poll 5s חייבים להישאר מתחת ל־1MB עבור history points מייצגים.
- 1s poll חייב להיכנס ב־2,000 point cap.

מדידה מייצגת בזמן הפיתוח הייתה בערך 6.9KB ל־full snapshot מול 0.26KB ל־compact point; זה נתון הנדסי למדידה, לא API guarantee.

---

## מצב CI

ה־workflow משתמש `cancel-in-progress` ו־shards מקבילים עבור route lifecycle, sessions, classifiers, SO semantics/scoring/templates, event/runtime, Influx, operational pipeline, service, packaging ו־Web.

כל כשל משמעותי שנמצא במהלך פיתוח הופך ל־regression קבוע לפני קידום baseline.

ה־implementation baseline המתועד הנוכחי הוא `907c4af7a9ecad94a724f3059d0afa13af395239`; ה־BW-GOV-010 fingerprint שלו הוא `e38d6e14a2b9ae28` עבור 271 קבצי implementation. השינוי מוסיף `evidenceVersion` ו־fail-closed אטומי כאשר late frame נכנס בין קריאת event evidence לשמירת recompute. `Navigation Input Integration #154` ו־`BW-SYNC-013 Raw Score Contract #21` עברו SUCCESS. `Blue Wolf CI #2953` סיים 29/30 jobs ירוקים וה־Web נכשל רק בגלל manifest הישן לפני סנכרון זה; נדרש post-sync CI חדש. Release עדיין חסום עד implementationApproval מפורש וללא טענה ל־customer Influx E2E.

## מה עדיין פתוח

1. **BW-SYNC-013 user re-verification** — מנגנון display-only smoothing ממומש ב-Web עם RAW/5/10/20/30 שניות (default 10s) ומשותף לגרף ולכרטיסי הקבוצה לאחר recompute. הוא אינו משנה raw Core score, alerts, events או grouping; הסעיף נשאר partial רק עד QA ויזואלי מפורש של המשתמש.
2. **Late-data recomputation / archive** — מרוץ של late frame מול recompute נסגר ב־`evidenceVersion` אטומי ו־fail-closed לפני persistence. עדיין פתוחים retention/version-history ארוך טווח, מדיניות correction מאוחרת מעבר לאירוע הפעיל, וכל חוזי After Action שאינם מכוסים בארכיון האירועים הנוכחי.
3. **Full load/robustness campaign** — BW-DATA-010 כבר מודד InfluxDB2 2.7 אמיתי → Flux → temporal join → Core → RuntimeSnapshot → HTTP מתחת ל-10s, ו-footprint serialization מכוסה; עדיין נדרש מסע עומס מלא בקנה מידה 10 servers / 150 vehicles לכל ממדי CPU/memory/late-data/restart.
4. **Operational deployment** — packaging קיים ונבדק ב-CI; נדרש deployment בפועל ברשת Windows/OpenShift הארגונית עם Influx, secrets ו-persistent volume אמיתיים.
5. **Sites demo** — הפריסה הציבורית נשארת demo ואינה מחליפה Python runtime ברשת הסגורה. אין להציג URL שלא פורסם ואומת בפועל.
6. **`DOUBLE_FIGURE_EIGHT`** — חסום עד אפיון גאומטרי מפורש; אינו milestone לביצוע כרגע.

### Current-head supersession

- SI ו-SO מחוברים כיום כ-first-class sibling families דרך `FamilyRuntimeHost` ו-`family_environment_factory.py`; אין עוד מצב current שבו SO הוא base ו-SI הוא extension.
- SI template עובר Web → Workspace → operational config → Python parser → `LiveSIRuntimeProducer` → SI scoring → RuntimeSnapshot, כולל regression שמוכיח ששינוי template משנה score בפועל.
- display smoothing מוגדר כיום כשכבת תצוגה בלבד ב-`lib/display-score-smoothing.ts`, עם חלונות 0/5/10/20/30 שניות; historical notes שבהם הנוסחה טרם הוגדרה נשמרים רק כ-history.
- `ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json` הוא catalog machine-checked לכל ברירות המחדל הפעילות של `CoreConfig`, `LivePollConfig` ו-`EventAlertConfig`, עם סיווג product/calibration/implementation_guard/compatibility ורציונל לכל סף.


### Documentation synchronization gate

`docs/documentation-sync.json` שומר fingerprint דטרמיניסטי של קבצי implementation וקישור ל-Master Specification ולמסמכי המחקר. `scripts/verify-documentation-sync.mjs` מחשב את fingerprint מחדש מתוך Git index. Release נחסם אם App/Core/Runtime/Deploy השתנו בלי refresh של תיעוד, כך ש-`BW-GOV-010` אינו תלוי עוד בזיכרון ידני בלבד.


## Recompute history governance refresh — 25/09/2026

ה־implementation baseline המחייב כעת הוא `2ec209e01f9ec02ff78ca239f2d69d5bc235378c`; ה־BW-GOV-010 fingerprint הוא `c7e1c6a5ea4c2a2b` עבור 272 קבצי implementation. ה־Master v2.8 וה־Core Research v1.2 ב־Drive כוללים את LATE-015 / סעיף ה.10 ונקראו חזרה עם אותו HEAD ו־fingerprint לפני עדכון המניפסט.

נוסף audit surface read-only לתוצאות recompute: Core חושף `GET /v1/investigation/recomputations` ו־Web חושף `/api/investigation/recomputations`. ההיסטוריה מחזירה metadata newest-first בלבד, עם limit בין 1 ל־200, כולל run/template/code/config/evidence versions, זמן יצירה, ספירות frames, summary ו־source מפורש כאשר קיים. היא אינה מחזירה points/navigation/routes מלאים ואינה משתתפת ב־scoring, grouping, template selection, alerts או route detection.

`evidenceVersion` נשאר guard אטומי ל־late data: recompute מיושן אינו נשמר אם קבוצת ה־frames השתנתה בין snapshot לבין persistence. run חדש לאחר late frame נשמר כגרסה חדשה ואינו דורס run קודם. simulation history אינו מוצג כ־durable Core archive ונכשל במפורש.

`Blue Wolf CI #2963` עבר את בדיקות ה־history החדשות ואת כל shards של ה־Python Core; כשל ה־Web היחיד היה BW-GOV-010 לפני סנכרון ה־fingerprint. לאחר readback של מסמכי ה־Drive עודכן manifest ב־commit `eb707a2b5c98957177530aa9cb5f631c79a1a82a`; post-sync CI חדש נדרש לפני קידום ה־verified CI evidence. Release נשאר חסום עד implementationApproval מפורש וללא טענה ל־customer Influx E2E.
