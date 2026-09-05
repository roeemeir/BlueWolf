import { timingSafeEqual } from "node:crypto";
import http from "node:http";

const listenHost = process.env.PREVIEW_GATE_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.PREVIEW_GATE_PORT ?? 4173);
const upstreamHost = process.env.PREVIEW_UPSTREAM_HOST ?? "127.0.0.1";
const upstreamPort = Number(process.env.PREVIEW_UPSTREAM_PORT ?? 3000);
const password = process.env.PREVIEW_PASSWORD ?? "";
const token = process.env.PREVIEW_TOKEN ?? "";

if (!password || !token) {
  throw new Error("PREVIEW_PASSWORD and PREVIEW_TOKEN are required");
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header, name) {
  const entries = String(header ?? "").split(";").map((part) => part.trim());
  const prefix = `${name}=`;
  return entries.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function loginHtml(message = "") {
  const note = message ? `<p class="error">${message}</p>` : "";
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>Blue Wolf Preview</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 80% 0,#1b70c833,transparent 32%),#07111d;color:#f5f8fb}.card{width:min(420px,100%);padding:28px;border:1px solid #ffffff22;border-radius:28px;background:#102333d9;backdrop-filter:blur(24px);box-shadow:0 24px 80px #0007}.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}.logo{width:52px;height:52px;border-radius:17px;display:grid;place-items:center;background:linear-gradient(145deg,#0a84ff,#56c8ff);font-size:28px}.brand strong{font-size:21px}.brand span{display:block;color:#9fb2c5;font-size:12px;margin-top:2px}label{display:grid;gap:8px;color:#bdc9d5;font-size:13px}input,button{width:100%;min-height:48px;border-radius:15px;font:inherit}input{border:1px solid #ffffff20;background:#081724;color:#fff;padding:0 14px;outline:none}input:focus{border-color:#4da3ff;box-shadow:0 0 0 3px #4da3ff25}button{margin-top:12px;border:0;background:#0a84ff;color:#fff;font-weight:750;cursor:pointer}.hint{margin:18px 0 0;color:#8fa4b8;font-size:12px;line-height:1.6}.error{color:#ff9a94;background:#ff5f5714;border:1px solid #ff5f5733;border-radius:12px;padding:9px 11px;font-size:12px}</style>
</head>
<body><main class="card"><div class="brand"><div class="logo">🐺</div><div><strong>זאב כחול</strong><span>Protected validation preview</span></div></div>${note}<form method="post" action="/__bluewolf_login"><label>סיסמת בדיקה<input name="password" type="password" autocomplete="current-password" autofocus required /></label><button type="submit">כניסה לגרסת הבדיקה</button></form><p class="hint">זוהי סביבת בדיקה זמנית של ענף האימות. לאחר הכניסה הדפדפן ישמור Cookie מאובטח למשך זמן הרצת ה־preview.</p></main></body></html>`;
}

function sendLogin(response, message = "") {
  const body = loginHtml(message);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function proxyRequest(request, response) {
  const headers = { ...request.headers };
  headers.host = "terminal.local";
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = request.headers.host ?? "";

  const upstream = http.request({
    host: upstreamHost,
    port: upstreamPort,
    method: request.method,
    path: request.url,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Blue Wolf preview upstream is unavailable.");
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://preview.local");

  if (url.pathname === "/__bluewolf_login" && request.method === "POST") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (!constantTimeEqual(form.get("password") ?? "", password)) {
        sendLogin(response, "הסיסמה אינה נכונה.");
        return;
      }
      response.writeHead(303, {
        location: "/",
        "set-cookie": `bw_preview=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7200`,
        "cache-control": "no-store",
      });
      response.end();
    });
    return;
  }

  if (url.pathname === "/__bluewolf_logout") {
    response.writeHead(303, {
      location: "/",
      "set-cookie": "bw_preview=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "cache-control": "no-store",
    });
    response.end();
    return;
  }

  const session = cookieValue(request.headers.cookie, "bw_preview");
  if (!constantTimeEqual(session, token)) {
    sendLogin(response);
    return;
  }

  proxyRequest(request, response);
});

server.listen(listenPort, listenHost, () => {
  console.log(`Blue Wolf preview gate listening on http://${listenHost}:${listenPort}`);
});
