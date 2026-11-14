import { config, missingConfig, randomToken, redirect, setCookie, STATE_COOKIE } from '../_lib/auth.js';

export function GET(req: Request): Response {
  if (missingConfig().length) return redirect('/#/data?sync=not-configured');
  const origin = new URL(req.url).origin;
  const state = randomToken();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config().clientId);
  url.searchParams.set('redirect_uri', `${origin}/api/auth/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  // No scopes: we only need to know who you are.
  return redirect(url.toString(), [setCookie(STATE_COOKIE, state, 600)]);
}
