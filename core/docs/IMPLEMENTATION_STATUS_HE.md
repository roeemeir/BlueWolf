# מצב מימוש — Blue Wolf Core + Operational Runtime

## התשובה הקצרה

הפרויקט כבר אינו רק ליבה אלגוריתמית מבודדת. על branch `spec-conformant-vector-core` קיימת כיום שרשרת מבצעית מפורשת:

`InfluxDB2 -> temporal join -> adaptive CoreSession -> structural grouping -> SO live scoring -> Event/Alert runtime -> versioned live contract -> Operator`

לצידה קיימים polling awake/idle, rollback לאחר poll כושל, checkpoint אטומי, restart continuity, ASGI runtime service, Windows/OpenShift packaging, live map positions, ו־30 דקות live history קומפקטי ל־Operator.

ה־baseline האחרון שנסגר **במלואו** לפני גל השיפורים האחרון הוא:

`spec-conformant-vector-core @ 9a6de173801b5d1d97411af667eb205298c03ece`

`Blue Wolf CI` run `780` — **success מלא**.

מאז baseline זה נוספו checkpoint cadence, time-based/compact history ו־footprint guards. ה־code head של גל זה לפני commits תיעודיים הוא:

`b3a7e0404f6369baa65bcd9ae40d278cc1a92b64`

ב־Run `796` על head קודם באותו גל עברו בהצלחה Web, `runtime-service`, `operational-pipeline` ו־runtime packaging לפני שה־workflow הוחלף על ידי push נוסף. Run `798` נפתח ל־`b3a7e040`; baseline חדש ייקבע רק לאחר run מלא שאינו cancelled.

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

ה־baseline המלא האחרון הוא Run `780` על `9a6de173`. קידום baseline הבא יתבצע רק לאחר run מלא על הקוד הכולל compact history + footprint guard.

## מה עדיין פתוח

1. **Displayed-score policy** — קיים `displayed_smoothing_seconds=10`, אך אין נוסחת smoothing מוגדרת. עד החלטת מפרט operational displayed score נשאר fail-closed; אין raw fallback.
2. **SI operational live publication** — ה־runtime operational הנוכחי מחבר SO; SI דורש serializer/bindings/live pipeline מקבילים.
3. **Late-data recomputation / archive** — live history של 30 דקות אינו תחליף ל־After Action persistence ארוך טווח. נדרש storage/versioned recomputation נפרד.
4. **Full load/robustness campaign** — footprint serialization מכוסה; עדיין נדרשים CPU, Influx query latency, Core processing, memory ו־HTTP tests עבור סדר גודל 10 servers / 150 vehicles.
5. **Operational deployment** — packaging קיים; נדרש deployment בפועל ברשת Windows/OpenShift עם Influx אמיתי, secrets ו־persistent volume.
6. **Sites demo** — הפריסה הציבורית נשארת demo ואינה מחליפה Python runtime ברשת הסגורה. אין להציג URL שלא פורסם ואומת בפועל.
7. **`DOUBLE_FIGURE_EIGHT`** — חסום עד אפיון מפורש; אינו milestone לביצוע כרגע.
