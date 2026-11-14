/**
 * Watch identification with Claude: vision on the user's photos plus web
 * search to confirm references, calibres and production years.
 *
 * Runs straight from the browser with the user's own API key (bring your own
 * key), so the open-source app needs no server and nobody else pays for it.
 */

const KEY = 'escapement:ai';
const API_URL = 'https://api.anthropic.com/v1/messages';

export const AI_MODELS: Array<[string, string]> = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (most thorough, best for vintage)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'],
];

export interface AiSettings {
  apiKey: string;
  model: string;
}

export function loadAi(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '', model: typeof raw.model === 'string' ? raw.model : AI_MODELS[0][0] };
  } catch {
    return { apiKey: '', model: AI_MODELS[0][0] };
  }
}

export function saveAi(patch: Partial<AiSettings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadAi(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}

export interface Identification {
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  name: string | null;
  brand: string | null;
  model: string | null;
  reference: string | null;
  caliber: string | null;
  movementType: 'automatic' | 'manual' | 'quartz' | 'solar' | 'kinetic' | 'spring-drive' | null;
  bph: number | null;
  liftAngle: number | null;
  jewels: number | null;
  /** Movement size as text, e.g. "25.6 mm" or "11½'''". */
  size: string | null;
  years: string | null;
  cautions: string[];
  alternatives: Array<{ name: string; reason: string }>;
  nextSteps: string[];
  sources: Array<{ title: string; url: string }>;
}

const SYSTEM = `You are an expert horologist helping a collector identify a mechanical watch from their photos and notes. Many of their watches are vintage, with vague or missing details.

How to work:
- Read every marking you can see: dial text and signatures, logos, case shape, hands, indices, lume, crown, caseback engravings, reference and serial numbers (often between the lugs or inside the caseback), movement engravings, calibre numbers and jewel counts.
- Use web search to confirm the reference, calibre and production years against reliable sources: manufacturer archives, established reference databases and well-regarded collector resources. Search for exact markings you can read.
- For movement specifications (beat rate, jewels, size, related calibres), Ranfft DB at ranfft.org is a strong source: look up the calibre there when you can.
- Be honest about uncertainty. If the photos can't confirm something, leave that field null and lower the confidence. Never invent a reference or calibre number.
- Note anything a collector should know, such as signs of a redial, replacement parts, a franken-watch, or a caseback that doesn't match the dial.
- Say whether the movement is automatic, hand-wound, quartz, solar quartz, kinetic or Spring Drive.
- Give the movement's beat rate in vibrations per hour (bph), jewel count and diameter when the calibre is known, and its lift angle in degrees only if it is documented.
- Suggest what extra photo or detail would settle any open question.

When you're done, call record_identification exactly once. Keep the summary to two to four plain sentences.`;

const RECORD_TOOL = {
  name: 'record_identification',
  description: 'Record the final identification of the watch. Call exactly once, after any research.',
  input_schema: {
    type: 'object',
    properties: {
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string', description: 'What the watch most likely is and the evidence for it.' },
      name: { type: ['string', 'null'], description: 'A short display name, e.g. "Seiko Bell-Matic 4006-7000".' },
      brand: { type: ['string', 'null'] },
      model: { type: ['string', 'null'], description: 'Model or line name.' },
      reference: { type: ['string', 'null'] },
      caliber: { type: ['string', 'null'], description: 'Movement calibre, e.g. "4006A" or "ETA 2824-2".' },
      movementType: { type: ['string', 'null'], enum: ['automatic', 'manual', 'quartz', 'solar', 'kinetic', 'spring-drive', null], description: 'Kind of movement: automatic, manual (hand-wound), quartz, solar (light-powered quartz), kinetic (automatic quartz) or spring-drive.' },
      bph: { type: ['integer', 'null'], description: 'Beat rate in vibrations per hour, e.g. 21600. Null for quartz.' },
      liftAngle: { type: ['number', 'null'], description: 'Lift angle in degrees, only if documented.' },
      jewels: { type: ['integer', 'null'], description: 'Jewel count of the movement, if known.' },
      size: { type: ['string', 'null'], description: 'Movement diameter, e.g. "25.6 mm" or "11½\'\'\'", if known.' },
      years: { type: ['string', 'null'], description: 'Production years, e.g. "1968–1976".' },
      cautions: { type: 'array', items: { type: 'string' } },
      alternatives: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
      },
      nextSteps: { type: 'array', items: { type: 'string' }, description: 'Photos or details that would confirm the identification.' },
      sources: {
        type: 'array',
        items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] },
      },
    },
    required: ['confidence', 'summary'],
  },
};

export interface IdentifyInput {
  /** JPEG images, already resized. */
  images: Blob[];
  hint: string;
  known: { name?: string; brand?: string; reference?: string; caliber?: string };
}

type Block = { type: string; [k: string]: unknown };

export class AiError extends Error {}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function describeError(status: number, body: unknown): string {
  const msg = (body as { error?: { message?: string } })?.error?.message ?? '';
  if (status === 401) return 'Anthropic didn’t accept that API key. Check it under Data → AI identification.';
  if (status === 403) return `This API key isn’t allowed to do that. ${msg}`.trim();
  if (status === 429) return 'Rate limit reached on your API key. Wait a minute and try again.';
  if (status === 529 || status === 503) return 'Claude is busy right now. Try again in a moment.';
  if (status === 400 && /credit|balance/i.test(msg)) return 'Your Anthropic account is out of credit. Top it up in the Anthropic Console.';
  return msg ? `Identification failed: ${msg}` : `Identification failed (HTTP ${status}).`;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => Boolean(x)) : []);

export function normalize(input: Record<string, unknown>, searched: Array<{ title: string; url: string }>): Identification {
  const conf = input.confidence;
  const sources = Array.isArray(input.sources)
    ? (input.sources as Array<Record<string, unknown>>).map((s) => ({ title: str(s.title) ?? str(s.url) ?? '', url: str(s.url) ?? '' })).filter((s) => /^https?:\/\//.test(s.url))
    : [];
  return {
    confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
    summary: str(input.summary) ?? '',
    name: str(input.name),
    brand: str(input.brand),
    model: str(input.model),
    reference: str(input.reference),
    caliber: str(input.caliber),
    movementType: (['automatic', 'manual', 'quartz', 'solar', 'kinetic', 'spring-drive'] as const).find((t) => t === input.movementType) ?? null,
    bph: num(input.bph),
    liftAngle: num(input.liftAngle),
    jewels: num(input.jewels),
    size: str(input.size),
    years: str(input.years),
    cautions: strList(input.cautions),
    alternatives: Array.isArray(input.alternatives)
      ? (input.alternatives as Array<Record<string, unknown>>).map((a) => ({ name: str(a.name) ?? '', reason: str(a.reason) ?? '' })).filter((a) => a.name)
      : [],
    nextSteps: strList(input.nextSteps),
    sources: (sources.length ? sources : searched).slice(0, 6),
  };
}

export async function identifyWatch(
  input: IdentifyInput,
  settings: AiSettings,
  opts: { signal?: AbortSignal; onStatus?: (s: string) => void; fetchFn?: typeof fetch } = {},
): Promise<Identification> {
  if (!settings.apiKey) throw new AiError('Add your Anthropic API key first.');
  if (!input.images.length && !input.hint.trim()) throw new AiError('Add at least one photo or a few notes about the watch.');
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);

  const known = Object.entries(input.known)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const text = [
    input.images.length ? `Here ${input.images.length === 1 ? 'is a photo' : `are ${input.images.length} photos`} of my watch.` : 'I have no photos yet.',
    input.hint.trim() ? `What I know: ${input.hint.trim()}` : '',
    known ? `Already filled in (may be wrong):\n${known}` : '',
    'Please identify it.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const images = await Promise.all(input.images.map(blobToBase64));
  const messages: Array<{ role: 'user' | 'assistant'; content: Block[] | string }> = [
    {
      role: 'user',
      content: [...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })), { type: 'text', text }],
    },
  ];
  const searched: Array<{ title: string; url: string }> = [];
  opts.onStatus?.('Looking closely at the photos…');

  for (let round = 0; round < 6; round++) {
    let res: Response;
    try {
      res = await fetchFn(API_URL, {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          // Bring-your-own-key app: the key is the user's and never leaves their browser except to Anthropic.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: settings.model,
          max_tokens: 4096,
          system: SYSTEM,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }, RECORD_TOOL],
          messages,
        }),
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new AiError('Couldn’t reach Anthropic. Check your connection and try again.');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new AiError(describeError(res.status, body));

    const content: Block[] = Array.isArray(body?.content) ? body.content : [];
    for (const b of content) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') {
        const q = (b.input as { query?: string })?.query;
        if (q) opts.onStatus?.(`Searched: “${q}”`);
      }
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content as Array<{ title?: string; url?: string }>) {
          if (r.url && !searched.some((s) => s.url === r.url)) searched.push({ title: r.title ?? r.url, url: r.url });
        }
      }
    }

    const rec = content.find((b) => b.type === 'tool_use' && b.name === 'record_identification');
    if (rec) return normalize((rec.input ?? {}) as Record<string, unknown>, searched);

    messages.push({ role: 'assistant', content });
    if (body?.stop_reason !== 'pause_turn') {
      // Finished talking without recording: ask for the structured answer.
      messages.push({ role: 'user', content: 'Please record your identification now with the record_identification tool.' });
      opts.onStatus?.('Writing up the identification…');
    } else {
      opts.onStatus?.('Still researching…');
    }
  }
  throw new AiError('Claude didn’t finish the identification. Try again, perhaps with clearer photos.');
}
