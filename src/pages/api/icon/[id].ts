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

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  if (!/^\d+$/.test(id)) return json({ error: 'bad id' }, 400);
  try {
    const { icon } = await tnpGet(`/v2/icon/${id}`, {});
    const svg = !!icon?.icon_url;
    const u: string | undefined = svg ? icon.icon_url : icon?.thumbnail_url;
    if (!u || !okHost(u)) return json({ error: 'bad icon url' }, 502);
    const r = await fetch(u);
    if (!r.ok) return json({ error: `upstream ${r.status}` }, 502);
    const cache = 'public, max-age=86400';
    return svg
      ? new Response(await r.text(), { headers: { 'cache-control': cache, 'content-type': 'image/svg+xml' } })
      : new Response(await r.arrayBuffer(), { headers: { 'cache-control': cache, 'content-type': 'image/png' } });
  } catch (e: any) {
    return json({ error: String(e?.message ?? 'upstream error') }, 502);
  }
};
