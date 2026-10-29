import type { APIRoute } from 'astro';
import { tnpGet } from '../../../lib/tnp';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const okHost = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname.endsWith('.thenounproject.com');
  } catch {
    return false;
  }
};

const fail = (e: any) =>
  e?.message === 'server not configured'
    ? json({ error: 'server not configured' }, 500)
    : json({ error: /^upstream \d+$/.test(e?.message) ? e.message : 'upstream error' }, 502);

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  if (!/^\d{1,12}$/.test(id)) return json({ error: 'bad id' }, 400);
  try {
    const { icon } = await tnpGet(`/v2/icon/${id}`, {});
    const svg = !!icon?.icon_url;
    const u: string | undefined = svg ? icon.icon_url : icon?.thumbnail_url;
    if (!u || !okHost(u)) return json({ error: 'bad icon url' }, 502);
    const r = await fetch(u, { redirect: 'manual' });
    if (!r.ok) return json({ error: `upstream ${r.status}` }, 502);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 2_000_000) return json({ error: 'upstream error' }, 502);
    return new Response(buf, {
      headers: {
        'cache-control': 'public, max-age=86400',
        'content-type': svg ? 'image/svg+xml' : 'image/png',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch (e: any) {
    return fail(e);
  }
};
