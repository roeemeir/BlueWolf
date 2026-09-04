function safeBaseUrl(value: string) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http/https are supported');
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string; organization?: string; token?: string };
    const url = safeBaseUrl((body.url ?? '').trim());
    const organization = (body.organization ?? '').trim();
    const token = (body.token ?? '').trim();
    const signal = AbortSignal.timeout(4500);

    const health = await fetch(`${url}/health`, { method: 'GET', signal, headers: { accept: 'application/json' } });
    if (!health.ok) return Response.json({ ok: false, stage: 'health', status: health.status }, { status: 502 });

    if (token && organization) {
      const auth = await fetch(`${url}/api/v2/buckets?org=${encodeURIComponent(organization)}&limit=1`, {
        method: 'GET', signal, headers: { accept: 'application/json', authorization: `Token ${token}` },
      });
      if (!auth.ok) return Response.json({ ok: false, stage: 'auth', status: auth.status }, { status: auth.status === 401 || auth.status === 403 ? 401 : 502 });
    }

    return Response.json({ ok: true, url, organization, authenticated: Boolean(token && organization) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'connection failed';
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
