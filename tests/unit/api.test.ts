import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tnpGet = vi.hoisted(() => vi.fn());
// Fake by default; real tnp when SUPERLITE_REAL=1 (fetch is stubbed either way).
vi.mock('../../src/lib/tnp', async (orig) =>
  process.env.SUPERLITE_REAL ? await (orig as any)() : { tnpGet },
);

import { GET as search } from '../../src/pages/api/search';
import { GET as icon } from '../../src/pages/api/icon/[id]';

const REAL = !!process.env.SUPERLITE_REAL;
const SVG_URL = 'https://static.thenounproject.com/svg/123.svg';
const PNG_URL = 'https://static.thenounproject.com/png/123-200.png';
const searchResp = { icons: [{ id: '123', thumbnail_url: PNG_URL, icon_url: SVG_URL, attribution: 'Cat by Ann from Noun Project' }], next_page: 'abc' };
const call = (h: any, u: string, params: any = {}) => h({ url: new URL(u), params } as any);
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  tnpGet.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  if (REAL) {
    process.env.THEN_KEY = 'k';
    process.env.THEN_SEC = 's';
  }
});
afterEach(() => vi.unstubAllGlobals());

// Fake tnpGet and (in real mode) the stubbed fetch both serve the same body.
const mockUpstream = (body: any, cdn: Record<string, Response> = {}) => {
  tnpGet.mockResolvedValue(body);
  fetchMock.mockImplementation(async (u: any) => {
    const s = String(u);
    if (cdn[s]) return cdn[s];
    if (s.includes('api.thenounproject.com')) return new Response(JSON.stringify(body), { status: 200 });
    throw new Error('unexpected fetch ' + s);
  });
};
const mockUpstreamError = (status: number) => {
  tnpGet.mockRejectedValue(new Error(`upstream ${status}`));
  fetchMock.mockResolvedValue(new Response('', { status }));
};

describe('search', () => {
  it('maps results', async () => {
    mockUpstream(searchResp);
    const r = await call(search, 'http://x/api/search?q=cat');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ icons: [{ id: '123', thumb: PNG_URL, attribution: 'Cat by Ann from Noun Project' }], next: 'abc' });
  });
  it('400 missing q', async () => {
    const r = await call(search, 'http://x/api/search');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toEqual({ error: 'missing q' });
  });
  it('test_search_next_passthrough', async () => {
    mockUpstream(searchResp);
    await call(search, 'http://x/api/search?q=cat&next=abc');
    if (REAL) expect(String(fetchMock.mock.calls[0][0])).toContain('next_page=abc');
    else expect(tnpGet.mock.calls[0][1]).toMatchObject({ next_page: 'abc' });
  });
  it('test_upstream_error_502', async () => {
    mockUpstreamError(403);
    const r = await call(search, 'http://x/api/search?q=cat');
    expect(r.status).toBe(502);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toEqual({ error: 'upstream 403' });
  });
  it('test_no_secret_leak_on_error', async () => {
    process.env.THEN_SEC = 'topsecret';
    mockUpstreamError(500);
    const r = await call(search, 'http://x/api/search?q=a%20b*');
    expect(await r.text()).not.toContain('topsecret');
  });
});

describe('icon', () => {
  it('svg', async () => {
    mockUpstream({ icon: { id: '123', icon_url: SVG_URL, thumbnail_url: PNG_URL } }, { [SVG_URL]: new Response('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    const r = await call(icon, 'http://x/api/icon/123', { id: '123' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(await r.text()).toContain('<svg');
  });
  it('400 bad id', async () => {
    const r = await call(icon, 'http://x/api/icon/abc', { id: 'abc' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'bad id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('400 id injection', async () => {
    const r = await call(icon, 'http://x/api/icon/1', { id: '1/../2' });
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('test_icon_rejects_foreign_host', async () => {
    mockUpstream({ icon: { id: '123', icon_url: 'https://evil.com/x.svg', thumbnail_url: PNG_URL } });
    const r = await call(icon, 'http://x/api/icon/123', { id: '123' });
    expect(r.status).toBe(502);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('evil.com'))).toBe(false);
  });
  it('rejects lookalike host', async () => {
    mockUpstream({ icon: { id: '123', icon_url: 'https://evilthenounproject.com/x.svg' } });
    const r = await call(icon, 'http://x/api/icon/123', { id: '123' });
    expect(r.status).toBe(502);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('evilthenoun'))).toBe(false);
  });
  it('test_icon_png_fallback', async () => {
    mockUpstream({ icon: { id: '123', thumbnail_url: PNG_URL } }, { [PNG_URL]: new Response(new Uint8Array([137, 80, 78, 71])) });
    const r = await call(icon, 'http://x/api/icon/123', { id: '123' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(new Uint8Array(await r.arrayBuffer())[0]).toBe(137);
  });
  it('icon upstream error 502', async () => {
    mockUpstreamError(403);
    const r = await call(icon, 'http://x/api/icon/123', { id: '123' });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'upstream 403' });
  });
});
