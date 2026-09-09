# זאב כחול — פריסת Runtime מבצעי

מסמך זה מתאר את מעטפת הפריסה של שירות `bluewolf-runtime` שנמצא ב־`core/`.
המעטפת הנוכחית היא **single process / single worker** משום ש־`RuntimeSnapshotStore`
הוא process-local. אין להגדיל replicas או workers לפני הכנסת שכבת persistence
משותפת.

## מה מוכן באבן הדרך הזו

- endpoint בריאות: `GET /healthz`.
- endpoint נתונים: `GET /v1/live-runtime?serverId=<id>`.
- Bearer token דרך `BLUEWOLF_CORE_API_TOKEN`.
- stale/expire enforcement בצד השירות.
- InfluxDB2 adapter, WindowReader, polling cursor ו־transactional ingest coordinator.
- Docker image, OpenShift Deployment/Service ו־Windows launcher.

## מה עדיין אינו מחובר אוטומטית

שירות ה־ASGI עדיין אינו מפעיל בעצמו את producer שמתרגם את תוצאות
`Semantic CoreSession` ל־`bluewolf.live-runtime.v1` ומפרסם אותן ל־store.
החיבור הזה תלוי ב־metadata מבצעי מפורש (סוג רכב, מהירות עבודה, Route Instance,
constellation/template bank) ובהחלטת המוצר לגבי הציון המוחלק שמוצג למפעיל.
לכן `/healthz` מאשר שהשירות רץ — הוא **אינו** הוכחה שקיים snapshot מבצעי.
בקשת runtime ללא snapshot מחזירה 404/fail-closed.

## Docker

מ־root של המאגר:

```bash
docker build -f deploy/runtime/Dockerfile -t bluewolf-runtime:local .
docker run --rm -p 8080:8080 \
  -e BLUEWOLF_CORE_API_TOKEN='<secret>' \
  bluewolf-runtime:local
```

בדיקת שירות:

```bash
curl http://127.0.0.1:8080/healthz
```

אין להכניס token ל־Dockerfile או ל־Git.

## OpenShift

1. בונים ומעלים image שנבנה מ־`deploy/runtime/Dockerfile` ל־registry המאושר.
2. מעדכנים את `image:` ב־`deploy/openshift/runtime.yaml`.
3. יוצרים Secret מחוץ ל־Git, לדוגמה:

```bash
oc create secret generic bluewolf-runtime-secrets \
  --from-literal=core-api-token='<secret>'
```

4. מחילים:

```bash
oc apply -f deploy/openshift/runtime.yaml
```

ה־Deployment מוגדר `replicas: 1` ו־`Recreate` בכוונה כדי למנוע שני stores
process-local במקביל.

## Windows

PowerShell מתוך root של המאגר:

```powershell
.\deploy\windows\install-runtime.ps1
$env:BLUEWOLF_CORE_API_TOKEN = '<secret>'
.\deploy\windows\run-runtime.ps1
```

בפריסה כשירות Windows יש לספק את `BLUEWOLF_CORE_API_TOKEN` דרך מנגנון secrets /
service environment של הארגון ולא לשמור אותו בקובץ script.

## משתני סביבה של שירות ה־API

- `BLUEWOLF_CORE_API_TOKEN` — Bearer token; חובה בפריסה המבצעית.
- `BLUEWOLF_RUNTIME_HOST` — ברירת מחדל `0.0.0.0`.
- `BLUEWOLF_RUNTIME_PORT` — ברירת מחדל `8080`.
- `BLUEWOLF_RUNTIME_STALE_SECONDS` — ברירת מחדל `15`.
- `BLUEWOLF_RUNTIME_EXPIRE_SECONDS` — ברירת מחדל `60`, חייב להיות גדול מסף stale.

הגדרות Influx אינן מועברות עדיין ל־ASGI service עצמו; הן שייכות ל־producer
שיחובר באבן הדרך הבאה.
