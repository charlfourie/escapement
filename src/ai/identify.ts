/**
 * Watch identification, two free ways:
 *
 * - **Chat (default):** the app writes a request; the user pastes it, with
 *   their photos, into the Claude or Gemini app they already use, then pastes
 *   the reply back. No API, no key, nothing billed, and the chat app can
 *   search the web.
 * - **Gemini API:** one tap, using the user's own free Gemini API key (from
 *   Google AI Studio, no billing). The free tier has no web search, so the
 *   model works from what it knows.
 *
 * Both ask for the same JSON answer and share one parser.
 */

const KEY = 'escapement:ai';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export type AiProvider = 'chat' | 'gemini';

/** Free-tier Gemini models that read images (Google's pricing page, Nov 2026). */
export const GEMINI_MODELS: Array<[string, string]> = [
  ['gemini-3.8-flash', 'Gemini 3.8 Flash (best free model)'],
  ['gemini-3.6-flash', 'Gemini 3.6 Flash'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite (fastest)'],
];

export interface AiSettings {
  provider: AiProvider;
  geminiKey: string;
  geminiModel: string;
}

export function loadAi(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      provider: raw.provider === 'gemini' ? 'gemini' : 'chat',
      geminiKey: typeof raw.geminiKey === 'string' ? raw.geminiKey : '',
      geminiModel: typeof raw.geminiModel === 'string' && raw.geminiModel ? raw.geminiModel : GEMINI_MODELS[0][0],
    };
  } catch {
    return { provider: 'chat', geminiKey: '', geminiModel: GEMINI_MODELS[0][0] };
  }
}

export function saveAi(patch: Partial<AiSettings>): void {
  try {
    const { provider, geminiKey, geminiModel } = { ...loadAi(), ...patch };
    // Rewriting the whole entry also drops the old Anthropic key, if any.
    localStorage.setItem(KEY, JSON.stringify({ provider, geminiKey, geminiModel }));
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
  /** Production date decoded from a serial number, with how it was decoded. */
  dated: string | null;
  cautions: string[];
  alternatives: Array<{ name: string; reason: string }>;
  nextSteps: string[];
  sources: Array<{ title: string; url: string }>;
}

const GUIDE = `You are an expert horologist helping a collector identify a watch from their photos and notes. Many of their watches are vintage, with vague or missing details.

How to work:
- Read every marking you can see: dial text and signatures, logos, case shape, hands, indices, lume, crown, caseback engravings, reference and serial numbers (often on the caseback or between the lugs), movement engravings, calibre numbers and jewel counts.
- The calibre matters most: it sets the beat rate and lift angle the collector's timegrapher needs. Prefer a calibre read from the caseback or movement over one guessed from the dial. Give the actual calibre number (e.g. "8200A", "7S26"), never just "automatic" or "manual wind".
- If a serial number is visible, decode the production date when the maker's scheme allows it (Seiko and Citizen serials encode the year and month, for example) and say how you decoded it. Mention that a one-digit year is ambiguous by decade and use the calibre's production years to choose.
- For movement specifications (beat rate, jewels, size, related calibres), Ranfft DB at ranfft.org is a strong source.
- Be honest about uncertainty. If the photos can't confirm something, leave that field null and lower the confidence. Never invent a reference or calibre number.
- Note anything a collector should know, such as signs of a redial, replacement hands or crown, a franken-watch, or a caseback that doesn't match the dial.
- Say whether the movement is automatic, hand-wound, quartz, solar quartz, kinetic or Spring Drive.
- Give the beat rate in vibrations per hour (bph), jewel count and diameter when the calibre is known, and the lift angle in degrees only if it is documented.
- Suggest what extra photo or detail would settle any open question.`;

const FORMAT = `Answer with one JSON object and nothing else, using these keys (null when unknown):
{
  "confidence": "high" | "medium" | "low",
  "summary": "2–4 plain sentences: what it most likely is and the evidence",
  "name": "short display name, e.g. Seiko Bell-Matic 4006-7000",
  "brand": string, "model": string, "reference": string,
  "caliber": "movement calibre number",
  "movementType": "automatic" | "manual" | "quartz" | "solar" | "kinetic" | "spring-drive",
  "bph": integer beat rate in vibrations per hour (null for quartz),
  "liftAngle": number in degrees, only if documented,
  "jewels": integer, "size": "movement diameter, e.g. 25.6 mm",
  "years": "production years, e.g. 1968–1976",
  "dated": "production date decoded from the serial, with how, e.g. March 1976 (serial 63xxxxx: 6 = 1976, 3 = March)",
  "cautions": [strings], "alternatives": [{"name": string, "reason": string}],
  "nextSteps": [strings: photos or details that would confirm it],
  "sources": [{"title": string, "url": string}]
}`;

export interface IdentifyInput {
  /** JPEG images, already resized (for the API route). */
  images: Blob[];
  hint: string;
  known: { name?: string; brand?: string; reference?: string; caliber?: string };
}

export class AiError extends Error {}

function describeInput(input: IdentifyInput, photos: number): string {
  const known = Object.entries(input.known)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return [
    photos ? `I've attached ${photos === 1 ? 'a photo' : `${photos} photos`} of my watch.` : 'I have no photos yet.',
    input.hint.trim() ? `What I know: ${input.hint.trim()}` : '',
    known ? `Already filled in (may be wrong):\n${known}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The request to paste into a chat app. `photos` is how many the user will
 * attach there.
 */
export function buildChatPrompt(input: IdentifyInput, photos: number): string {
  return [
    'Please identify my watch for my watch-collection app (Escapement).',
    describeInput(input, photos),
    GUIDE,
    '- If you can search the web, confirm the reference, calibre and years against reliable sources (manufacturer archives, established reference databases, Ranfft DB, well-regarded collector sites) and list them as sources.',
    FORMAT.replace('Answer with one JSON object and nothing else', 'Finish your reply with one JSON object in a ```json code block (the app reads it)'),
  ].join('\n\n');
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => Boolean(x)) : []);
const GENERIC_CALIBER = /^(automatic|manual|hand[- ]?(wound|wind)|manual[- ]wind|quartz|mechanical|unknown)$/i;

export function normalize(input: Record<string, unknown>, grounded: Array<{ title: string; url: string }> = []): Identification {
  const conf = input.confidence;
  const sources = Array.isArray(input.sources)
    ? (input.sources as Array<Record<string, unknown>>).map((s) => ({ title: str(s?.title) ?? str(s?.url) ?? '', url: str(s?.url) ?? '' })).filter((s) => /^https?:\/\//.test(s.url))
    : [];
  const caliber = str(input.caliber);
  return {
    confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
    summary: str(input.summary) ?? '',
    name: str(input.name),
    brand: str(input.brand),
    model: str(input.model),
    reference: str(input.reference),
    // "Automatic" is a movement type, not a calibre.
    caliber: caliber && !GENERIC_CALIBER.test(caliber) ? caliber : null,
    movementType: (['automatic', 'manual', 'quartz', 'solar', 'kinetic', 'spring-drive'] as const).find((t) => t === input.movementType) ?? null,
    bph: num(input.bph),
    liftAngle: num(input.liftAngle),
    jewels: num(input.jewels),
    size: str(input.size),
    years: str(input.years),
    dated: str(input.dated),
    cautions: strList(input.cautions),
    alternatives: Array.isArray(input.alternatives)
      ? (input.alternatives as Array<Record<string, unknown>>).map((a) => ({ name: str(a?.name) ?? '', reason: str(a?.reason) ?? '' })).filter((a) => a.name)
      : [],
    nextSteps: strList(input.nextSteps),
    sources: [...sources, ...grounded.filter((g) => !sources.some((s) => s.url === g.url))].slice(0, 6),
  };
}

/** Find the JSON object in a chat reply (fenced or bare) and read it. */
export function parseAnswer(text: string): Identification {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let m; (m = fence.exec(text)); ) candidates.push(m[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  // Prefer the last fenced block: replies sometimes quote the format first.
  for (const c of candidates.reverse()) {
    try {
      const obj = JSON.parse(c.trim().replace(/[“”]/g, '"'));
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && ('summary' in obj || 'brand' in obj || 'caliber' in obj)) {
        const id = normalize(obj as Record<string, unknown>);
        if (id.summary || id.brand || id.caliber || id.reference) return id;
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new AiError('Couldn’t find the answer’s JSON block. Copy the whole reply, including the part in the code box, and paste it again.');
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function geminiError(status: number, body: unknown): string {
  const e = (body as { error?: { message?: string; status?: string } })?.error;
  const msg = e?.message ?? '';
  if (status === 400 && /api key/i.test(msg)) return 'Google didn’t accept that Gemini API key. Check it under Data → AI identification.';
  if (status === 403) return `This Gemini key isn’t allowed to do that. ${msg}`.trim();
  if (status === 404) return 'That Gemini model isn’t available to your key. Pick another model under Data → AI identification.';
  if (status === 429) return 'The free Gemini quota is used up for now (it resets daily). Try again later, or use the copy-and-paste route.';
  if (status === 500 || status === 503) return 'Gemini is busy right now. Try again in a moment.';
  return msg ? `Identification failed: ${msg}` : `Identification failed (HTTP ${status}).`;
}

/** One-tap identification with the user's free Gemini API key. */
export async function identifyWithGemini(
  input: IdentifyInput,
  settings: Pick<AiSettings, 'geminiKey' | 'geminiModel'>,
  opts: { signal?: AbortSignal; fetchFn?: typeof fetch } = {},
): Promise<Identification> {
  if (!settings.geminiKey) throw new AiError('Add your free Gemini API key first.');
  if (!input.images.length && !input.hint.trim()) throw new AiError('Add at least one photo or a few notes about the watch.');
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const images = await Promise.all(input.images.map(blobToBase64));
  const text = [
    describeInput(input, images.length),
    'You can’t search the web here, so work from what you know. Lower the confidence where you are relying on memory, and say what to check on Ranfft DB or the maker’s archive.',
    FORMAT,
  ].join('\n\n');

  let res: Response;
  try {
    res = await fetchFn(`${GEMINI_URL}/${encodeURIComponent(settings.geminiModel)}:generateContent`, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: GUIDE }] },
        contents: [{ role: 'user', parts: [...images.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })), { text }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new AiError('Couldn’t reach Gemini. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(geminiError(res.status, body));

  const cand = body?.candidates?.[0];
  const reply = ((cand?.content?.parts ?? []) as Array<{ text?: string }>).map((p) => p.text ?? '').join('');
  if (!reply.trim()) {
    const why = cand?.finishReason ?? body?.promptFeedback?.blockReason;
    throw new AiError(`Gemini didn’t return an answer${why ? ` (${why})` : ''}. Try again, perhaps with clearer photos.`);
  }
  return parseAnswer(reply);
}
