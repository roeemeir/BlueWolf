import http from 'node:http';

const upstream = (process.env.BLUEWOLF_QA_UPSTREAM || 'http://127.0.0.1:3000').replace(/\/$/, '');
const port = Number(process.env.BLUEWOLF_QA_PROXY_PORT || 8787);
const user = process.env.BLUEWOLF_QA_USER || '';
const pass = process.env.BLUEWOLF_QA_PASS || '';
if (!user || !pass) throw new Error('BLUEWOLF_QA_USER and BLUEWOLF_QA_PASS are required');
const expected = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== expected) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Blue Wolf QA"', 'cache-control': 'no-store' });
    res.end('Authentication required');
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value == null || ['host', 'authorization', 'content-length'].includes(name.toLowerCase())) continue;
      if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
      else headers.set(name, value);
    }
    const target = new URL(req.url || '/', upstream);
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
      redirect: 'manual',
    });
    const outHeaders = {};
    response.headers.forEach((value, name) => {
      if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) outHeaders[name] = value;
    });
    outHeaders['cache-control'] = outHeaders['cache-control'] || 'no-store';
    res.writeHead(response.status, outHeaders);
    if (req.method === 'HEAD') return res.end();
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('QA proxy error');
    console.error(error);
  }
});
server.listen(port, '127.0.0.1', () => console.log('Blue Wolf QA auth proxy listening on 127.0.0.1:' + port));
