# זאב כחול — תכן זיהוי נתיבים אוטומטי V2

מסמך זה מתעד את **מימוש הזיהוי האוטומטי** בלבד. הוא אינו רשאי להגדיר גאומטריית מוצר חדשה.

## 1. מקורות אמת וסדר קדימות

1. `ROUTE_GEOMETRY_SPEC_HE.md` — מקור האמת המחייב לצורות הנתיב, topology, סימולטור ומקרי חוסר מידע.
2. מסמך זה — קובע כיצד האלגוריתם מנסה לזהות את הגאומטריות שכבר אושרו.
3. `ADAPTIVE_ROUTE_LIFECYCLE_HE.md` — קובע Candidate/Confirmed/Replacement, חלון היסטוריה אדפטיבי וזמן שינוי רטרואקטיבי.
4. `V1_SPEC_HE.md` — מפרט המוצר הרחב.

**כלל מחייב:** אם פרט גאומטרי או סמנטי אינו מוגדר במסמכי הדרישות — אין להשלים אותו מהיגיון, מזיכרון או משם הצורה. עוצרים ומבקשים הבהרה לפני מימוש.

## 2. עקרונות תכנון

- הזמן שחלף אינו ראיה לנתיב.
- 40 דקות הן תקרת history בלבד, לא זמן המתנה.
- סדר הזמן של הדגימות הוא מידע יסודי ואינו נזרק לצורך clustering מרחבי.
- חישובי hot-path על ההיסטוריה יהיו וקטוריים ככל האפשר.
- אין לבנות מטריצת מרחקים `N×N` על 40 דקות היסטוריה.
- אין להמציא מיקום בתוך חור תקשורת. slot חסר נשאר `observed_mask=False`.
- geometry hypothesis רשאית לחבר חזותית/נומרית phase bins חסרים לצורך fit, אבל bins כאלה אינם מקבלים observability/coverage credit.
- SI נשמר כ-centerline אמיתי של העקבה ואינו מוחלף באליפסה.
- זווית פתיחת Double Hippodrome היא פרמטר גאומטרי רציף. 10°–40° הוא **QA sampling priority בלבד**.

## 3. Pipeline

```text
VehicleSample history
      │
      ▼
VectorSampleAdapter
WGS84 -> local metric arrays
explicit missing slots
      │
      ▼
Masked periodic recurrence
FFT O(N log N)
      │
      ▼
Local lag refinement
small bounded jitter window
      │
      ▼
Periodic support mask
recurrent samples only
      │
      ▼
Phase folding
robust canonical centerline <=64 bins
+ authoritative support mask
      │
      ▼
Topology/model classifier
Figure-8 / Double / SI / Hippodrome / Free
      │
      ▼
ClosedRoute adapter
      │
      ▼
Adaptive lifecycle
Candidate / Confirmed / Replacement
```

## 4. מבנה נתונים וקטורי

החישוב הפנימי משתמש במערכים צפופים:

```text
time_s            (N,)
xy_m              (N,2)
observed_mask      (N,)
velocity_xy_mps    (N,2) optional
```

Slots ללא מיקום תקין מקבלים `observed_mask=False`. ערך מספרי placeholder במערך אינו observation ואסור לשום אלגוריתם לצרוך אותו בלי mask.

`VehicleSample -> VectorTrack` מתבצע ב-`vector_sample_adapter.py`:

- stream יחיד בלבד בכל קריאה.
- WGS84 -> local metric frame באמצעות NumPy.
- cadence יכול להגיע מה-logical grid של המערכת או להיאמד מהמרווחים הצפופים בין דגימות.
- outage גדול אינו מגדיל את cadence המוערך.
- אין interpolation של position בשכבה זו.

## 5. זיהוי מחזור

### 5.1 FFT masked recurrence

`masked_lag_mse()` מחשב לכל lag את:

```text
mean ||x[t+lag] - x[t]||²
```

רק עבור זוגות שבהם שתי הדגימות נצפו.

החישוב משתמש בזהות אלגברית וב-FFT correlation ולכן הוא `O(N log N)` ואינו יוצר `N×N` distances.

יתרון חשוב: אם הדגימות בפניות חסרות, שתי הישורות החוזרות ממחזור למחזור עדיין יכולות לייצר minimum ברור של recurrence.

### 5.2 Local lag refinement

FFT הוא proposal מהיר ולא קיבוע מדויק של period. approach/exit, רוח וחוסר דגימות יכולים להזיז את המינימום בכמה samples.

לכן לאחר FFT נבדק חלון קטן ומוגבל סביב ה-lag שנבחר. העלות היא `O(KN)` כאשר `K` קטן וחסום.

זה **אינו timer** ואינו דרישת זמן מבצעית.

## 6. Periodic support

אין לדרוש counterpart בדיוק ב-lag יחיד. סביב ה-period המעודן נבדק חלון lag קטן, וכל sample שמקבל spatial recurrence באחד ה-offsets מקבל support.

מטרות:

- לסבול period estimate של 244s למסלול פיזי של ~240s בלי לאבד את כל ה-observability.
- לבודד approach/exit חד-פעמיים מהחלק המחזורי.
- לשמור על חורי תקשורת כ-missing ולא להמציא דגימות.

## 7. Phase folding ו-centerline קנוני

דגימות recurrent מקופלות לפי phase ל-64 bins לכל היותר.

לכל bin נשמרים בנפרד:

- canonical point robust — median של הדגימות שנצפו באותה פאזה.
- sample count.
- `canonical_support` — האם הפאזה באמת נצפתה.

Bins לא נצפים יכולים לעבור circular interpolation **רק לצורך geometry hypothesis / model fit**. הם אינם counted כ-coverage.

מרכז וצירים מחושבים מהמסלול הקנוני המאוזן בפאזה, ולא מענן raw שבו straight legs עשויים להיות over-sampled עקב אובדן תקשורת בפניות.

## 8. סיווג topology

סדר ההכרעה הנוכחי:

### 8.1 Figure-8

Figure-8 דורש self-crossing אמיתי בין שני segments שה-phase bins בקצותיהם **נצפו בפועל**.

Interpolated segment לבדו אינו רשאי לייצר crossing evidence.

אין דרישה ללגים ישרים.

### 8.2 Double Hippodrome

Double נבדק מול model ישיר של:

```text
exterior(boundary(union(capsule_1, capsule_2)))
```

כאשר שני ה-capsules חולקים אותו turn-circle center, בהתאם למפרט המאושר.

- opening angle נסרק על התחום הגאומטרי כפרמטר solver.
- אין acceptance rule של 10°–40°.
- נדרש fit מוחלט טוב וגם model separation ברור לעומת Single Hippodrome.
- כאשר הצורה עצמה compact (`axis ratio <= 1.5`), נדרש evidence טופולוגי חזק יותר כדי לא להפוך SI חופשי ל-Double רק משום שתבנית מורכבת יכולה להתאים לו.
- thresholds אלה הם **calibration values**, לא חוקי מוצר.

### 8.3 SI

אם לא הוכחה topology של Figure-8/Double והמסלול הסגור compact לפי המפרט (`axis ratio <= 1.5`) — המשפחה היא SI.

ה-centerline הקנוני נשמר כפי שנמדד. Circle, Octagon וצורה חופשית אינם דורשים primitive נפרד לצורך משפחת SI.

### 8.4 Single Hippodrome

מסלול מוארך אינו Hippodrome רק בגלל axis ratio. נדרש fit למודל capsule/racetrack.

### 8.5 Free / Unknown

מסלול מחזורי שאינו מתאים למשפחות המאושרות מוחזר כ-`FREE/UNKNOWN` ולא נכפה בכוח על topology אחר.

## 9. Double-Hippodrome opening-angle QA

הסימולטור דוגם בצפיפות גבוהה:

```text
10, 15, 20, 25, 30, 35, 40 deg
```

ומוסיף edge cases, כיום למשל:

```text
5, 50, 60 deg
```

הרשימות הן test bank בלבד. אין לייבא אותן ל-classifier ואין להשתמש בהן כ-validation range.

## 10. אובדן תקשורת בפניות

זהו תרחיש חובה ולא edge case נדיר.

הבדיקות חייבות לכלול מצב שבו:

- straight/soft legs נצפים היטב.
- 98% בקירוב מדגימות turn-region נופלות.
- קיימים מספר contiguous turn outages.
- לשרת מגיעים בפועל בעיקר שני legs עם חורים גדולים ביניהם.

האלגוריתם משתמש ב-periodic recurrence, phase support וב-fit כולל. הוא אינו מסיק "אין פנייה" בגלל חוסר מידע.

## 11. DBSCAN / clustering מרחבי

DBSCAN נבדק כרעיון אך **אינו מנוע הזיהוי הראשי**:

- הוא אינו שומר את סדר הזמן כחלק מהמודל.
- שימוש נאיבי על כל ההיסטוריה יכול ליצור עלות זיכרון/זמן שאינה מתאימה ל-hot path.
- אין צורך בו עבור period recurrence שכבר נפתר בצורה וקטורית עם FFT.

ניתן לשקול בעתיד DBSCAN או clustering אחר **רק על סט קטן של features נגזרים**, למשל turn-center hypotheses, אם benchmark מוכיח יתרון. אין dependency כזה כרגע בליבה.

## 12. ביצועים

כללים מחייבים:

- history-wide recurrence: `O(N log N)` FFT.
- local period refinement/support: `O(KN)` עם `K` קטן וחסום.
- topology/model fit כבד: רק על canonical evidence של עד 64 נקודות.
- Shapely משמש ליצירת hypotheses גאומטריים קטנים ומטמון templates, לא בלולאת per-sample.
- templates נשמרים ב-cache.
- בדיקות performance ימדדו זמן classification ולא רק correctness.

## 13. מצב מימוש נכון לעכשיו

ממומש ונבדק:

- simulator מאושר עבור SI / Hippodrome / Figure-8 / Double Hippodrome.
- רוח משתנה, GPS noise/spikes, turn-dependent loss ו-contiguous turn outages.
- masked FFT recurrence.
- local period refinement.
- explicit periodic support.
- phase-balanced canonical fold.
- Figure-8 supported crossing.
- Double union-of-capsules model ללא angle gate.
- SI generic compact centerline.
- VehicleSample -> VectorTrack עם missing slots מפורשים.
- adapter ניסיוני V2 ל-`ClosedRoute` נמצא בבדיקות side-by-side.

עדיין לא הושלם:

- partial-cycle candidate של V2. כרגע V2 המלא דורש recurrence כדי להחזיר hypothesis. **אין להסתיר זאת באמצעות timer או באמצעות ellipse/stadium detector הישן.**
- חיבור V2 ל-`CoreSession` כ-source of truth.
- הסרת `route_detection.py` הישן לאחר equivalence/regression מלא.
- known-route fast recognition מול Route Bank.
- phase disambiguation ב-Figure-8 בתוך ה-live projection.
- `DOUBLE_FIGURE_EIGHT` — לא מוגדר גאומטרית ולכן חסום לחלוטין.

## 14. שער לפני שינוי עתידי

לפני כל שינוי ב-detector יש לבדוק:

1. האם ההתנהגות מוגדרת ב-`ROUTE_GEOMETRY_SPEC_HE.md`?
2. האם מדובר בדרישת מוצר או רק בסף כיול?
3. האם התרחיש קיים בסימולטור/GT?
4. האם נבדקו חוסר דגימות בפניות, רוח, noise ו-sample rate?
5. האם נבדקה זווית Double מחוץ ל-10°–40° כדי למנוע overfitting?
6. האם שינוי מגדיל complexity של hot path? אם כן — benchmark לפני merge.
7. אם פרט אינו מוגדר — עוצרים ושואלים את המשתמש.
