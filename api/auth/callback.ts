import { config, getCookie, makeSession, redirect, sessionCookie, setCookie, STATE_COOKIE } from '../_lib/auth.js';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const clearState = setCookie(STATE_COOKIE, '', 0);
  if (!code || !state || state !== getCookie(req, STATE_COOKIE)) return redirect('/#/data?sync=failed', [clearState]);

  const c = config();
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: `${url.origin}/api/auth/callback` }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return redirect('/#/data?sync=failed', [clearState]);

    const userRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'escapement' },
    });
    const user = (await userRes.json()) as { login?: string };
    if (!user.login || user.login.toLowerCase() !== c.owner) return redirect('/#/data?sync=denied', [clearState]);
    return redirect('/#/data?sync=signed-in', [clearState, sessionCookie(await makeSession(user.login))]);
  } catch {
    return redirect('/#/data?sync=failed', [clearState]);
  }
}
