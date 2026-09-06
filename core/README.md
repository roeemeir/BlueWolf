# זאב כחול — Canonical Python Core

הליבה האלגוריתמית הקנונית הנוכחית של Blue Wolf היא חבילת Python עצמאית.
המערכת מזהה נתיבים סגורים מתוך נתוני ניווט מאוחדים, מעריכה זמן מחזור ופאזה,
משייכת רכבים לקבוצות סנכרון ומחשבת ציוני נתיב/סנכרון/כולל.

## עקרונות מחייבים

- `CORE_API_VERSION = 1.0.0` הוא החוזה היציב מול האפליקציה.
- המימוש הנוכחי הוא Python; החוזה נשאר ניטרלי לשפה כדי שאפשר יהיה להחליף Core בעתיד בלי לשנות UI/DB כאשר החוזה תואם.
- הליבה אינה מכירה InfluxDB, SQLite, React/UI, HTTP או PDF.
- InfluxDB הוא מקור האמת של הניווט האמיתי; שכבת Ingest+Join מחוץ לליבה מייצרת `VehicleSample` מנורמל.
- אין TTAG בחוזה או בלוגיקת ה־Join הנדרשת.
- אותו `CoreSession` משמש ל־Live ול־Replay היסטורי.
- הזמן האלגוריתמי נשמר ב־UTC וברשת לוגית של שנייה אחת.
- ב־Live נשלח Batch מסודר כל 5 שניות; ה־Batch מכיל נקודות זמן נפרדות ואינו ממוצע.
- Checkpoint של מצב CoreSession נשמר חיצונית כל 5 דקות.
- כל הנתיבים מיוצגים כנתיב סגור גנרי; polyline קנוני הוא באורך משתנה. מעגל, מתומן, היפודרום או מסלול סגור לא־מעגלי משתמשים באותו חוזה.
- אם זווית מרכז אינה ייצוג טבעי למסלול, הפאזה מוגדרת כאורך קשת מנורמל לאורך הנתיב הסגור.
- שיוך לקבוצה מבוסס על גיאומטריה/מחזור/כיוון רלוונטי בלבד — לעולם לא על הציון.
- חלון היציבות עובד בטווח configurable של 30–60 שניות, בעוד `Candidate -> Assigned` דורש 120 שניות רצופות של התאמה.
- GT הוא oracle נפרד לבדיקות/כיול בלבד ואינו קלט לליבת הייצור.

## Persistence פשוט

Blue Wolf לא שומר עותק קבוע נוסף של Raw NAV או Joined NAV כאשר הניווט זמין ב־Influx.
Joined NAV הוא תוצר חישובי/Cache זמני וניתן לבנייה מחדש.

ה־DB של Blue Wolf שומר רק מידע שאינו ניתן לשחזור מה־Influx:
- Workspace/configuration;
- thresholds/weights/templates;
- GT;
- route bank;
- user edits/overrides;
- audit;
- CoreSession checkpoints.

תוצאות אוטומטיות היסטוריות מחושבות מחדש באמצעות ה־Core הקנוני הנוכחי ויכולות להימחק/להיבנות מחדש.

## מצב המימוש

הליבה כוללת כבר:

1. חוזי נתונים יציבים.
2. קונפיגורציה עם `logical_grid_seconds=1`, `live_batch_seconds=5`, `checkpoint_seconds=300` ו־`membership_confirmation_seconds=120`.
3. מנוע ציונים טהור ודטרמיניסטי.
4. גיאומטריית נתיב מחזורית ו־projection לפי polyline סגור.
5. `CoreSession` מצבי עם checkpoint גרסאי.
6. Join זמני למטריקות Influx נפרדות ללא TTAG.
7. סימולטור ובדיקות שקילות Batch/Increment.
8. SO/Template/Sync utilities מהאפיון המאוחר יותר.

ה־TypeScript package תחת `packages/bluewolf-core/` הוא compatibility/reference בזמן המעבר ואינו הליבה הקנונית המבצעית.

## בדיקה מקומית

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
```

הרצת הדגמה:

```bash
PYTHONPATH=src python scripts/run_core_demo.py
```

בדיקת־עצמי:

```bash
PYTHONPATH=src python scripts/run_core_self_test.py
```

מסמכי הארכיטקטורה הקנוניים נמצאים ב־`docs/BLUE_WOLF_ARCHITECTURE_V1_7_SIMPLIFIED_CANONICAL.md` וב־`docs/BLUE_WOLF_ARCHITECTURE_DECISIONS_2026-09-06_V1_7.md`.
