import { describe, expect, it } from 'vitest';
import { AiError, identifyWatch } from '../src/ai/identify';

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

const settings = { apiKey: 'sk-ant-test', model: 'claude-opus-5-5' };
const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });

describe('identifyWatch', () => {
  it('sends photos with web search, continues paused turns, and returns the recorded identification', async () => {
    const { fn, calls } = mockFetch([
      {
        body: {
          stop_reason: 'pause_turn',
          content: [
            { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Seiko 4006-7000 Bell-Matic' } },
            { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', title: 'Seiko 4006 Bell-Matic', url: 'https://example.com/bellmatic' }] },
          ],
        },
      },
      {
        body: {
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Done.' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'record_identification',
              input: { confidence: 'high', summary: 'A Seiko Bell-Matic alarm.', brand: 'Seiko', model: 'Bell-Matic', reference: '4006-7000', caliber: '4006A', bph: 19800, liftAngle: null, years: '1970s', cautions: [], alternatives: [], nextSteps: ['Photo of the movement'] },
            },
          ],
        },
      },
    ]);
    const statuses: string[] = [];
    const id = await identifyWatch({ images: [photo], hint: 'grandfather’s', known: { name: 'Old Seiko' } }, settings, { fetchFn: fn, onStatus: (s) => statuses.push(s) });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-test');
    expect(calls[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(calls[0].body.model).toBe('claude-opus-5-5');
    expect(calls[0].body.tools.map((t: { name: string }) => t.name)).toEqual(['web_search', 'record_identification']);
    const first = calls[0].body.messages[0].content;
    expect(first[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(first[0].source.data).toBe(btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3)));
    expect(first[1].text).toContain('grandfather’s');
    expect(first[1].text).toContain('name: Old Seiko');
    // pause_turn: the paused assistant content is sent back to continue
    expect(calls[1].body.messages.at(-1).role).toBe('assistant');

    expect(id).toMatchObject({ confidence: 'high', brand: 'Seiko', reference: '4006-7000', caliber: '4006A', bph: 19800, liftAngle: null });
    expect(id.sources).toEqual([{ title: 'Seiko 4006 Bell-Matic', url: 'https://example.com/bellmatic' }]);
    expect(statuses).toContain('Searched: “Seiko 4006-7000 Bell-Matic”');
  });

  it('asks for the structured answer if Claude ends without recording', async () => {
    const { fn, calls } = mockFetch([
      { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Probably an Omega.' }] } },
      { body: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'record_identification', input: { confidence: 'nonsense', summary: 'Omega', bph: -5 } }] } },
    ]);
    const id = await identifyWatch({ images: [], hint: 'Omega Seamaster, 1960s', known: {} }, settings, { fetchFn: fn });
    expect(calls[1].body.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(id.confidence).toBe('low');
    expect(id.bph).toBeNull();
  });

  it('explains API errors in plain words', async () => {
    const { fn } = mockFetch([{ status: 401, body: { error: { message: 'invalid x-api-key' } } }]);
    await expect(identifyWatch({ images: [photo], hint: '', known: {} }, settings, { fetchFn: fn })).rejects.toThrow(/didn’t accept that API key/);
  });

  it('refuses without a key or input', async () => {
    await expect(identifyWatch({ images: [photo], hint: '', known: {} }, { ...settings, apiKey: '' })).rejects.toBeInstanceOf(AiError);
    await expect(identifyWatch({ images: [], hint: ' ', known: {} }, settings)).rejects.toBeInstanceOf(AiError);
  });
});
