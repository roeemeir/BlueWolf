# זאב כחול — מחזור חיים לאירועים, התראות והמלצות תבנית

מסמך זה מקבע את שכבת `EventAlertEngine` בהתאם ל־`V1_SPEC_HE.md` ול־`TEMPLATE_SELECTION_LIFECYCLE_HE.md`. הוא אינו מוסיף סמנטיקה חדשה ל־route detection, grouping או scoring.

## 1. גבולות אחריות

`EventAlertEngine` מקבל תצפיות שכבר חושבו בשכבות הקודמות ומנהל רק state תפעולי של אירוע, התראה והמלצה.

הוא אינו:

- מזהה נתיב.
- משנה `group_id` או membership.
- מחשב score.
- בוחר תבנית פעילה.
- מחליף תבנית אוטומטית בעקבות המלצה.

ה־caller מספק `context_key` יציב המייצג את ההקשר הסמנטי הפעיל של הקבוצה. שינוי `context_key`, שרת או תבנית פעילה מסיים את האירוע הפעיל ומתחיל אירוע חדש. ירידת score לבדה אינה משנה את ההקשר ולכן אינה פותחת אירוע חדש.

## 2. פתיחת וסיום אירוע

- התצפית הראשונה עבור `group_id + context_key` פותחת `EVENT_OPENED`.
- כאשר ההקשר משתנה, זמן סיום האירוע מיוחס לזמן התצפית שבה השינוי נצפה.
- אירוע שסיים פעילות אינו מפורסם כ־`EVENT_CLOSED` סופי מיד; הוא נשמר במצב pending-finalization למשך 120 שניות, בהתאם ל־V1.
- לאחר 120 שניות מופק `EVENT_CLOSED` עם `change_time_utc` של זמן הסיום האמיתי ועם `finalized_time_utc` נפרד.
- `restart` אינו סיבה לפתיחת אירוע חדש: כל state הדרוש נשמר ב־checkpoint וניתן לשחזור.

## 3. התראת ציון נמוך

לפי `ScoringConfig` הדיפולטי:

- streak מתחיל כאשר ציון קבוצה תקף נמוך מ־50.
- אחרי 10 שניות רצופות מתחת ל־50 מופק `ALERT_OPENED` מסוג `low_score`.
- `onset_time_utc` נשמר כתחילת ה־streak, בעוד `change_time_utc` הוא זמן הפליטה בפועל.
- סגירה דורשת 20 שניות רצופות בציון 60 ומעלה.
- score חסר/לא תקף אינו מפוברק; הוא מאפס streak שטרם הפך להתראה, ואינו נחשב recovery של התראה קיימת.
- אם האירוע מסתיים בזמן שהתראה פעילה, מופק `ALERT_CLOSED` מיידית עם `reason=event_ended`.

אישור/השתקת צליל של מפעיל שייכים לשכבת המוצר והממשק ואינם משנים את state האלגוריתמי של התקלה.

## 4. המלצת תבנית חלופית

המלצה היא state נפרד מן הבחירה הפעילה:

- כל ציוני התבניות שמושווים באותה תצפית חייבים להיות מאותו score dimension.
- תבנית חלופית הופכת למועמדת רק כאשר היא עדיפה על הפעילה ב־30 נקודות לפחות.
- אם אותה חלופה נשארת הטובה ביותר במשך 120 שניות רצופות, מופק `TEMPLATE_SUGGESTED`.
- אם במהלך ה־streak חלופה אחרת הופכת לטובה ביותר, חלון הראיות מתחיל מחדש עבור החלופה החדשה.
- הצעה פעילה נסגרת כאשר יתרונה של התבנית המוצעת יורד מתחת ל־15 נקודות במשך 30 שניות רצופות.
- דחיית מפעיל מוסיפה את `template_id` ל־rejected set של האירוע הנוכחי בלבד; עם פתיחת אירוע חדש ה־rejected set מתאפס.
- recommendation לעולם אינה משנה `SOTemplateSelectionRegistry` בעצמה.

## 5. דטרמיניזם ו־checkpoint

ה־state הנשמר כולל:

- `event_id`, `group_id`, `context_key`, זמן התחלה וה־active template.
- low-score opening/recovery streaks.
- recommendation candidate + זמן תחילת evidence.
- suggestion פעילה, close streak ו־rejected templates.
- אירועים שכבר הסתיימו אך עדיין ממתינים ל־finalization.

`export_state()` ו־`from_state()` חייבים לשמר את כל ה־streaks כך שריצה רציפה ושחזור checkpoint יפיקו את אותם אירועים בדיוק.

## 6. אימות

ה־regression suite כולל:

- פתיחת אירוע ראשוני.
- פתיחת low-score alert לאחר 10 שניות רצופות.
- שבירת opening streak על score לא תקף.
- recovery לאחר 20 שניות ב־60 ומעלה.
- recommendation לאחר יתרון 30 נקודות ל־120 שניות.
- restart של recommendation evidence כאשר best alternative משתנה.
- סגירת suggestion לאחר יתרון קטן מ־15 ל־30 שניות.
- rejection עד סוף האירוע בלבד.
- שינוי context ו־finalization של האירוע הישן לאחר 120 שניות.
- checkpoint באמצע low-score/recommendation streak.
- סיום אירוע בזמן alert פעיל.

Baseline מאומת: `spec-conformant-vector-core @ f9442f0716c37b5cf6f96bc778bec745eaad7eef`, ‏`Blue Wolf CI` run `652` — success.

## 7. שלבים שעדיין מחוץ למודול

- בניית `context_key` מתוך runtime end-to-end של Route/Group/Template versions.
- scoring בפועל של כל התבניות הרלוונטיות לצורך comparison, בלי לחשב temporal metrics פעמיים.
- alert acknowledgment / mute / sound-repeat במעטפת המפעיל.
- late-data correction וגרסאות אירוע מתוקנות.
- persistence מבצעי ל־SQLite/Parquet וחיבור למסכי Operator/Report.
