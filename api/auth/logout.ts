import { json, SESSION_COOKIE, setCookie } from '../_lib/auth.js';

export function POST(): Response {
  return json({ ok: true }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, '', 0) });
}
