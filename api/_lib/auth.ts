/**
 * Sign-in for the online collection: GitHub OAuth, restricted to one account
 * (OWNER_GITHUB), with a signed, HttpOnly session cookie. No database: the
 * session is an HMAC-signed payload.
 *
 * Environment:
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  from a GitHub OAuth app
 *   SESSION_SECRET                          long random string
 *   OWNER_GITHUB                            the one GitHub login allowed in
 */

export const SESSION_COOKIE = 'esc_session';
export const STATE_COOKIE = 'esc_state';
const SESSION_DAYS = 30;

export function config() {
  return {
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    secret: process.env.SESSION_SECRET ?? '',
    owner: (process.env.OWNER_GITHUB ?? '').trim().toLowerCase(),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
  };
}

export function missingConfig(): string[] {
  const c = config();
  const missing: string[] = [];
  if (!c.clientId) missing.push('GITHUB_CLIENT_ID');
  if (!c.clientSecret) missing.push('GITHUB_CLIENT_SECRET');
  if (c.secret.length < 32) missing.push('SESSION_SECRET');
  if (!c.owner) missing.push('OWNER_GITHUB');
  if (!c.blob) missing.push('Blob store');
  return missing;
}

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(config().secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function makeSession(login: string): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ login, exp: Date.now() + SESSION_DAYS * 86400_000 })).toString('base64url');
  return `${payload}.${await hmac(payload)}`;
}

/** The signed-in owner's login, or null. */
export async function readSession(req: Request): Promise<string | null> {
  const c = config();
  if (!c.secret || !c.owner) return null;
  const raw = getCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || !safeEqual(sig, await hmac(payload))) return null;
  try {
    const { login, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof login !== 'string' || typeof exp !== 'number' || exp < Date.now()) return null;
    return login.toLowerCase() === c.owner ? login : null;
  } catch {
    return null;
  }
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setCookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export const sessionCookie = (value: string) => setCookie(SESSION_COOKIE, value, SESSION_DAYS * 86400);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 302, headers });
}

/**
 * Gate for every data endpoint: a valid owner session, and for writes a custom
 * header that a cross-site form or image can't send (CSRF protection).
 */
export async function requireOwner(req: Request, write = false): Promise<string | Response> {
  if (write && req.headers.get('x-escapement') !== '1') return json({ error: 'Missing x-escapement header' }, 403);
  const login = await readSession(req);
  return login ?? json({ error: 'Not signed in' }, 401);
}

export function randomToken(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
