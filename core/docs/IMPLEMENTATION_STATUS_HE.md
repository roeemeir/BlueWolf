# מצב מימוש — הליבה האלגוריתמית

## התשובה הקצרה

הליבה האלגוריתמית נמצאת כעת על baseline מאומת הכולל רכישת נתיב אדפטיבית, החלפת נתיב אדפטיבית, סיווג SI/SO/Figure-8/Double Hippodrome, קיבוץ מבני יציב, semantic phase, מודל SO מנורמל, template fit, scoring bridge, template bank ו־Double active-lobe / role switching.

Baseline מאומת לפני commits תיעודיים:

`spec-conformant-vector-core @ 7f917412e1e89d8d47eabf980a2c26c22041ef80`

ריצת ה־CI של baseline זה עברה במלואה, לרבות shard ייעודי ל־Double active-lobe וכל regressions הקיימים של route lifecycle, grouping, SO ו־Web.

העיקרון המחייב לרכישת/שינוי Route הוא `ADAPTIVE_ROUTE_LIFECYCLE_HE.md`: זמן שחלף אינו ראיה. 40 דקות הן תקרת history בלבד ולא זמן המתנה.

`DOUBLE_HIPPODROME_SCORING_SEMANTICS_HE.md` קובע את משמעות ה־Double לצורך synchronization: נתיב פיזי רציף אחד, שני Hippodromes לוגיים לציון, active-lobe semantic phase והחלפת roles ללא תלות ב־vehicle ID.

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

תרחישי הפרעה כוללים:

- cadence של 1/2/5 שניות.
- GPS Gaussian noise ו־spikes.
- רוח משתנה בזמן בעוצמה ובכיוון.
- base dropout.
- turn-dependent dropout.
- contiguous outages בתוך פניות.
- approach/exit.
- sweep צפוף של Double opening angle בטווח 10°–40° וכן edge cases מחוץ לטווח. הטווח הוא QA priority בלבד ואינו gate של detector.

`DOUBLE_FIGURE_EIGHT` נשאר Undefined גאומטרית ואסור לממש אותו ללא אפיון מפורש נוסף.

## אבן דרך 3 — Vectorized automatic route detection V2 — הושלמה

- `VehicleSample` מותאם ל־`VectorTrack` אחיד עם `observed_mask` מפורש.
- אין interpolation של מיקום לתוך חורי תקשורת לצורך evidence.
- masked spatial recurrence מחושב לכל lag באמצעות FFT correlations בעלות `O(N log N)` במקום מטריצת `N×N`.
- period proposal עובר local lag refinement קטן וחסום.
- periodic support סובל jitter של period וחוסר דגימות.
- כאשר קיימת velocity בשני קצות recurrence pair, נדרשת גם heading consistency כדי למנוע approach crossing שווא.
- phase folding מפיק canonical centerline ו־support/count לכל phase bin.
- Coverage הוא circular phase coverage ואינו תלוי ישירות במספר occupied bins או ב־cadence.
- confirmed geometry משתמשת בכל observations האמיתיים בתוך recurrent traversal span, ולא רק בנקודות direct recurrence support.
- מרכז וצירים נגזרים ממעטפת מרחבית רובוסטית ולא ממדיאן raw samples.

### סיווג topology

ממומשים ומכוסים ברגרסיות:

- SI compact — Circle/Octagon/free closed נשמרים כ־centerline אמיתי ולא מוחלפים באליפסה.
- Single Hippodrome.
- Figure-8 עם self-crossing evidence אמיתי; interpolated segment לבדו אינו מייצר crossing.
- Double Hippodrome לפי המודל הגאומטרי המאושר.
- Free/Unknown כאשר אין התאמה למשפחה מאושרת.

זווית הפתיחה של Double אינה מוגבלת ל־10°–40° בקוד.

## אבן דרך 4 — Adaptive route lifecycle — הושלמה

### Route acquisition

- אין timer קבוע של 5 דקות.
- partial candidate הוא topology-neutral evidence ואינו מכריז family/route ID/period.
- Confirmation מבוסס fit, coverage, cycle travel ו־closure.
- חיפוש החלון משתמש קודם ב־geometric re-observation ולאחר מכן adaptive suffix search + refinement.
- search suffix וה־periodic evidence interval הם ישויות נפרדות; approach יכול להישאר ב־buffer בלי לקבל attribution למסלול.

### Route replacement

- Route מאושר אינו ננעל.
- cheap suspicion gate של distance/speed/heading מונע fit יקר כאשר המסלול הישן עדיין מסביר את הדגימה.
- שינוי חומרי מכויל סביב 20% geometry/period, לצד שינוי family/subtype/topology/direction ו־SO orientation כאשר רלוונטי.
- אין timer קבוע של 120 שניות לשינוי.
- replacement דורש evidence purity שמעדיף את B על A.
- period-only replacement משתמש ב־observed speed מול `length/period` של A/B ודורש רוב ברור של המשטר החדש.
- onset מיוחס רטרואקטיבית; `detection_time_utc` נשמר בנפרד.
- checkpoint באמצע A→B נשאר שקול לריצה רציפה.

## אבן דרך 5 — Structural Grouping V2 — הושלמה

Membership תלוי רק ב־geometry + period + reliability/lifecycle; synchronization score אינו משפיע על membership.

- SI משתמש complete-link כדי למנוע center chaining.
- SO משתמש connected structural chain של Route Instances שכנים.
- Single/Double period comparison משתמש base period normalization כאשר נדרש מבנית.
- membership evidence של 120s נמדד מתוך המידע שכבר נאסף; אין תוספת המתנה מלאכותית אחרי route confirmation.
- `group_id` נשמר כאשר overlap עם הקבוצה הקודמת הוא לפחות 60%.
- merge של שתי קבוצות יוצר ID חדש.
- membership hold הוא 300s בחוסר תקשורת.
- SI wrong-direction: alert לאחר 60s; removal רק לאחר 300s נוספים. היפוך משותף של הקבוצה מעדכן baseline direction ואינו מפרק אותה.
- Batch/Incremental/checkpoint equivalence מכוסה ב־integrated-session tests.

## אבן דרך 6 — Semantic Phase ו־SO normalized templates — הושלמה

### Semantic phase

- `VehicleFrameResult.phase` נשאר raw/legacy phase.
- נוסף `semantic_phase` עבור SO.
- frame גאומטרי קנוני מסיר raw phase-zero ו־polyline ordering differences.
- מספר Route Instances בקבוצה מיושרים באמצעות projective mean של major-axis orientations ללא תלות ב־vehicle ID או sample order.
- Figure-8 משתמש heading-aware branch selection באזור self-crossing; ללא evidence מספיק `semantic_phase=None` במקום ניחוש.

### מודל SO מנורמל

`SO Template -> Route Instances -> Vehicle Slots -> Quarter`

- `Single` עד שני Vehicle Slots.
- `Double` עד ארבעה Vehicle Slots.
- `Q0/Q1/Q2/Q3`.
- Same/Opposite/Mixed נגזרים מהפרש quarters ואינם נשמרים כפרמטר כפול.
- vehicle geometry/profile מופרד מסמנטיקת התבנית.
- Figure-8 ממופה ל־Single-SO synchronization semantics.
- Double Figure-8 נדחה במפורש כ־Undefined.

### Template fit / scoring bridge / bank

- template fit אינו תלוי ב־vehicle ID.
- assignment מתבצע לפי Route Instance + vehicle type + semantic phase.
- common phase/tie-break דטרמיניסטיים.
- `score_so_template` ממיר template fit ל־position error ומזין את `PrimitiveMetrics/score_vehicle` הקיימים; אין נוסחת ציון מקבילה.
- `SOTemplateBank` מסנן תבניות לפי composition/constellation ללא vehicle IDs.

## אבן דרך 7 — Double Hippodrome active-lobe / role switching — הושלמה ומאומתת

הבהרת האפיון האחרונה נפתרה במפורש:

- full physical Double נשאר Route אחד לצורכי recurrence, full period ו־lifecycle.
- synchronization רואה שני logical Single-Hippodrome scoring surfaces.
- בכל timestamp נבחר `active_so_component_id` לפי המיקום.
- `semantic_phase` של Double מחושב על ה־active lobe, לא על ידי `full_phase*2 mod 1`.
- כאשר שני lobes אפשריים באזור החיבור, velocity heading מול tangent משמש ל־disambiguation.
- כאשר גם heading אינו מבחין — אין role/semantic phase מומצא באותו timestamp.
- roles אינם נשמרים לפי vehicle ID; שני רכבים יכולים להחליף roles באופן טבעי בעקבות מעבר בין lobes.
- רכיבי ה־Double הם derived geometry דטרמיניסטי; אין operational state חדש שדורש hysteresis או checkpoint נפרד.

נוסף shard CI ייעודי `double-lobe-phase`. baseline `7f917412…` עבר CI מלא ירוק לאחר תיקון integration mismatch ב־SO phase API.

## מצב CI ואימות

ה־workflow כולל `cancel-in-progress` ו־shards מקבילים. בין השערים הפעילים:

- lifecycle smokes: fast acquisition, free-approach attribution, initial confirmation geometry, stable route, geometry replacement, period replacement.
- route-change remainder.
- session / integrated-session / semantic-session.
- classifiers / route-vector / fundamentals.
- SO templates / template fit / phase / scoring / template bank.
- Double active-lobe.
- Web: lint, TypeScript, tests.

כשל אלגוריתמי שהתגלה הופך ל־regression קבוע לפני קידום baseline.

### ביצועים

לאחר הוספת cheap route-suspicion gate, חבילת 60 בדיקות ליבה ירדה באחת מריצות ה־CI מכ־183.3s לכ־58.7s ללא regression. זהו נתון תצפית CI ולא benchmark פורמלי של חומרה קבועה. מאז הורחבה חבילת הבדיקות משמעותית וחולקה ל־shards מקבילים.

## תיעוד מחקר

נוסף `ALGORITHMIC_CORE_RESEARCH_LOG_HE.md` כיומן version-controlled לכל `Problem -> Hypothesis -> Experiment -> Result -> Change -> Regression -> Validation`.

בנוסף מופק דוח Word מחקרי מעוצב שמרכז את התכן, הנוסחאות, הסימולציות, התרשימים והיסטוריית failures/fixes. מעכשיו milestone אלגוריתמי משמעותי יתועד גם ביומן הריפו וגם בגרסה הבאה של הדוח.

## אבני הדרך הבאות

1. **Template Selection lifecycle** — default של מפתח, בחירה ידנית מתוך הבנק הרלוונטי, persistence לפי `group_id + constellation`, והמלצה חלופית לפי חוקי V1.
2. **End-to-end live scoring בתוך CoreSession** — `Route -> Group -> Semantic phase -> Template -> Metrics -> Vehicle scores -> Group score`.
3. **Event/Alert engine** מלא, כולל template recommendation lifecycle, alerts וסגירת/פתיחת events.
4. **Late-data correction + local persistence** ושחזור גרסאות חישוב.
5. **InfluxDB2 adapter** ומצב polling awake/sleep.
6. חיבור Python Core האמיתי לכל זרימות Operator/Report/Developer ב־Web במקום שכבות demo.
7. load/robustness campaign פורמלי עד סדר גודל של 10 שרתים / 150 כלי רכב, כולל history ceiling וחורי תקשורת ארוכים.
8. Windows/OpenShift packaging ו־release מאומת.

`DOUBLE_FIGURE_EIGHT` אינו milestone לביצוע עד שגאומטרייתו תוגדר מפורשות באיפיון.