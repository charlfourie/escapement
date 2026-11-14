import { json, missingConfig, readSession } from './_lib/auth.js';

/** Is online sync set up here, and who (if anyone) is signed in? */
export async function GET(req: Request): Promise<Response> {
  const missing = missingConfig();
  if (missing.length) return json({ configured: false, missing, login: null });
  return json({ configured: true, login: await readSession(req) });
}
