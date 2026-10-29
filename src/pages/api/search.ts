import type { APIRoute } from 'astro';
import { tnpGet } from '../../lib/tnp';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fail = (e: any) =>
  e?.message === 'server not configured'
    ? json({ error: 'server not configured' }, 500)
    : json({ error: /^upstream \d+$/.test(e?.message) ? e.message : 'upstream error' }, 502);

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'missing q' }, 400);
  const params: Record<string, string> = { query: q, limit: '48', thumbnail_size: '200', include_svg: '1' };
  const next = url.searchParams.get('next');
  if (next) params.next_page = next;
  try {
    const d = await tnpGet('/v2/icon', params);
    return json({
      icons: (d.icons ?? []).map((i: any) => ({ id: String(i.id), thumb: i.thumbnail_url, attribution: i.attribution })),
      next: d.next_page ?? null,
    });
  } catch (e: any) {
    return fail(e);
  }
};
