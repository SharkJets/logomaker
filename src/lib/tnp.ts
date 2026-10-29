import { createHmac, randomBytes } from 'node:crypto';

const TNP_BASE = 'https://api.thenounproject.com';

// RFC3986: encodeURIComponent also escapes !*'()
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

export function authHeader(
  url: string,
  params: Record<string, string>,
  key: string,
  secret: string,
  nonce: string,
  ts: string,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: key,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: ts,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}=${enc(all[k])}`)
    .join('&');
  const base = `GET&${enc(url)}&${enc(paramStr)}`;
  const sig = createHmac('sha1', `${enc(secret)}&`).update(base).digest('base64');
  const fields = { ...oauth, oauth_signature: sig };
  return (
    'OAuth ' +
    Object.entries(fields)
      .map(([k, v]) => `${k}="${enc(v)}"`)
      .join(', ')
  );
}

export async function tnpGet(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.THEN_KEY ?? '';
  const secret = process.env.THEN_SEC ?? '';
  const url = TNP_BASE + path;
  const query = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  const auth = authHeader(
    url,
    params,
    key,
    secret,
    randomBytes(16).toString('hex'),
    String(Math.floor(Date.now() / 1000)),
  );
  const res = await fetch(query ? `${url}?${query}` : url, {
    headers: { Authorization: auth },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}
