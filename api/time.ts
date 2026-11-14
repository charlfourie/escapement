/**
 * Reference time for time checks. Vercel's servers keep NTP time, so this is
 * usually closer to the truth than a phone or laptop clock.
 */
export function GET(): Response {
  return new Response(JSON.stringify({ now: Date.now() }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
