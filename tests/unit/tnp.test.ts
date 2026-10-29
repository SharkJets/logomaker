import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeader, tnpGet } from '../../src/lib/tnp';

const hmac = (base: string, key: string) =>
  createHmac('sha1', key).update(base).digest('base64');

const sigOf = (header: string) => {
  const m = /oauth_signature="([^"]+)"/.exec(header);
  if (!m) throw new Error('no oauth_signature in header');
  return decodeURIComponent(m[1]);
};

describe('authHeader', () => {
  it('test_signature_vector', () => {
    const h = authHeader(
      'https://api.thenounproject.com/v2/icon',
      { query: 'cat', limit: '1' },
      'k',
      's',
      'n',
      '1',
    );
    const base =
      'GET&https%3A%2F%2Fapi.thenounproject.com%2Fv2%2Ficon&limit%3D1%26oauth_consumer_key%3Dk%26oauth_nonce%3Dn%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1%26oauth_version%3D1.0%26query%3Dcat';
    expect(sigOf(h)).toBe(hmac(base, 's&'));
  });

  it('test_header_shape', () => {
    const h = authHeader('https://api.thenounproject.com/v2/icon', {}, 'k', 's', 'n', '1');
    expect(h.startsWith('OAuth ')).toBe(true);
    expect(h).toContain('oauth_consumer_key="k"');
    expect(h).toContain('oauth_signature_method="HMAC-SHA1"');
  });

  it('test_percent_encoding', () => {
    const h = authHeader(
      'https://api.thenounproject.com/v2/icon',
      { query: 'a b*' },
      'k',
      's',
      'n',
      '1',
    );
    const base =
      'GET&https%3A%2F%2Fapi.thenounproject.com%2Fv2%2Ficon&oauth_consumer_key%3Dk%26oauth_nonce%3Dn%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1%26oauth_version%3D1.0%26query%3Da%2520b%252A';
    expect(base).toContain('query%3Da%2520b%252A');
    expect(sigOf(h)).toBe(hmac(base, 's&'));
  });

  it('test_secret_not_in_header', () => {
    const h = authHeader('https://api.thenounproject.com/v2/icon', {}, 'k', 's3cr3t', 'n', '1');
    expect(h).not.toContain('s3cr3t');
  });
});

describe('tnpGet', () => {
  beforeEach(() => {
    process.env.THEN_KEY = 'k';
    process.env.THEN_SEC = 's';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('test_tnpGet_throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(tnpGet('/v2/icon', { query: 'x' })).rejects.toThrow('upstream 403');
  });

  it('test_tnpGet_url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(tnpGet('/v2/icon', { query: 'cat' })).resolves.toEqual({ a: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.thenounproject.com/v2/icon?query=cat');
    expect(init.headers.Authorization.startsWith('OAuth ')).toBe(true);
  });
});
