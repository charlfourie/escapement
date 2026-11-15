import { describe, expect, it } from 'vitest';
import { AiError, buildChatPrompt, identifyWithGemini, normalize, parseAnswer } from '../src/ai/identify';

type Call = { url: string; headers: Record<string, string>; body: any };

function mockFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });
const answer = {
  confidence: 'high',
  summary: 'A Seiko Bell-Matic alarm.',
  brand: 'Seiko',
  model: 'Bell-Matic',
  reference: '4006-7000',
  caliber: '4006A',
  movementType: 'automatic',
  bph: 19800,
  dated: 'March 1976 (serial 63xxxxx)',
  sources: [{ title: 'Ranfft', url: 'https://ranfft.org/x' }],
};

describe('chat route', () => {
  it('builds a request that carries the notes, known fields and the JSON format', () => {
    const p = buildChatPrompt({ images: [], hint: 'grandfather’s', known: { name: 'Old Seiko', brand: '' } }, 2);
    expect(p).toContain('attached 2 photos');
    expect(p).toContain('grandfather’s');
    expect(p).toContain('- name: Old Seiko');
    expect(p).not.toContain('- brand:');
    expect(p).toContain('```json');
    expect(p).toContain('"dated"');
  });

  it('reads the JSON from a chat reply with prose and a code fence', () => {
    const reply = `Here's what I found.\n\nIt looks like a Bell-Matic.\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n\nHope that helps!`;
    const id = parseAnswer(reply);
    expect(id).toMatchObject({ confidence: 'high', brand: 'Seiko', caliber: '4006A', bph: 19800, movementType: 'automatic', dated: 'March 1976 (serial 63xxxxx)' });
    expect(id.sources).toEqual([{ title: 'Ranfft', url: 'https://ranfft.org/x' }]);
  });

  it('reads a bare JSON reply and prefers the last block', () => {
    expect(parseAnswer(JSON.stringify(answer)).reference).toBe('4006-7000');
    const twoBlocks = '```json\n{"summary": "format example", "brand": "X"}\n```\nAnswer:\n```json\n' + JSON.stringify(answer) + '\n```';
    expect(parseAnswer(twoBlocks).brand).toBe('Seiko');
  });

  it('explains when there is no JSON to read', () => {
    expect(() => parseAnswer('I could not tell from the photo, sorry.')).toThrow(AiError);
  });

  it('drops generic “calibres” that are only movement types', () => {
    expect(normalize({ summary: 's', caliber: 'Automatic' }).caliber).toBeNull();
    expect(normalize({ summary: 's', caliber: 'Manual-Wind' }).caliber).toBeNull();
    expect(normalize({ summary: 's', caliber: '8200A' }).caliber).toBe('8200A');
    expect(normalize({ summary: 's', bph: '21,600 bph' }).bph).toBe(21600);
  });
});

describe('identifyWithGemini', () => {
  it('sends the photos and notes to the chosen free model and reads the JSON reply', async () => {
    const { fn, calls } = mockFetch([{ body: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] } }]);
    const id = await identifyWithGemini({ images: [photo], hint: 'dial says Bell-Matic', known: { name: 'Old Seiko' } }, { geminiKey: 'AIza-test', geminiModel: 'gemini-3.8-flash' }, { fetchFn: fn });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('AIza-test');
    const parts = calls[0].body.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3)) } });
    expect(parts[1].text).toContain('dial says Bell-Matic');
    expect(calls[0].body.generationConfig.responseMimeType).toBe('application/json');
    expect(calls[0].body.tools).toBeUndefined(); // no paid search grounding
    expect(id.caliber).toBe('4006A');
  });

  it('turns quota and key errors into plain messages', async () => {
    const quota = mockFetch([{ status: 429, body: { error: { message: 'Resource exhausted' } } }]);
    await expect(identifyWithGemini({ images: [photo], hint: '', known: {} }, { geminiKey: 'k', geminiModel: 'm' }, { fetchFn: quota.fn })).rejects.toThrow(/free Gemini quota/);
    const bad = mockFetch([{ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }]);
    await expect(identifyWithGemini({ images: [photo], hint: '', known: {} }, { geminiKey: 'k', geminiModel: 'm' }, { fetchFn: bad.fn })).rejects.toThrow(/didn’t accept/);
  });

  it('needs a key and something to identify', async () => {
    await expect(identifyWithGemini({ images: [photo], hint: '', known: {} }, { geminiKey: '', geminiModel: 'm' })).rejects.toThrow(/key/);
    await expect(identifyWithGemini({ images: [], hint: ' ', known: {} }, { geminiKey: 'k', geminiModel: 'm' })).rejects.toThrow(/photo/);
  });
});
