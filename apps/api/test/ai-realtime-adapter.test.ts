/**
 * Realtime adapters against a LOCAL stand-in WebSocket server (no network, no key): the wire
 * format we send (session configuration, audio, interruptions), the events we map back, usage
 * aggregation and error handling. This does not prove the live OpenAI API behaves this way.
 */
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadEnv } from '../src/config/env';
import { AiProviderError } from '../src/integrations/ai';
import { configuredRealtimeProviders, createOpenAiRealtimeProvider, createRealtimeProviders, type RealtimeEvent } from '../src/integrations/ai/realtime';
import { addResponseUsage, addTranscriptionUsage } from '../src/integrations/ai/realtime/openai-realtime';
import { createSimulatedRealtimeProvider, pcmLevel } from '../src/integrations/ai/realtime/simulated-realtime';
import { emptyRealtimeUsage } from '../src/integrations/ai/realtime/types';

let wss: WebSocketServer;
let url: string;
let last: { req: IncomingMessage; ws: WebSocket; received: any[] } | null = null;
let script: (msg: any, ws: WebSocket) => void = () => undefined;
let reject401 = false;

beforeAll(async () => {
  wss = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    verifyClient: (_info, cb) => (reject401 ? cb(false, 401, 'Unauthorized') : cb(true)),
  });
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v1/realtime`;
  wss.on('connection', (ws, req) => {
    const conn = { req, ws, received: [] as any[] };
    last = conn;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      conn.received.push(m);
      script(m, ws);
    });
  });
});
afterAll(() => new Promise<void>((r) => wss.close(() => r())));

const send = (ws: WebSocket, e: object) => ws.send(JSON.stringify(e));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('OpenAI Realtime adapter', () => {
  it('authenticates server-side and configures a VAD session that never answers on its own', async () => {
    script = (m, ws) => m.type === 'session.update' && send(ws, { type: 'session.updated', session: {} });
    const p = createOpenAiRealtimeProvider('sk-test-key-0123456789abcdef', 5000, url);
    const events: RealtimeEvent[] = [];
    const s = await p.connect({
      model: 'gpt-realtime-2.1-mini',
      instructions: 'POLICY',
      language: 'ar',
      history: [{ role: 'user', content: 'سؤال سابق' }, { role: 'assistant', content: 'إجابة سابقة' }],
      maxOutputTokens: 9000,
      requestId: 'r1',
      endUserRef: 'opaque-ref',
      onEvent: (e) => events.push(e),
    });
    await wait(50);
    expect(last!.req.url).toBe('/v1/realtime?model=gpt-realtime-2.1-mini');
    expect(last!.req.headers.authorization).toBe('Bearer sk-test-key-0123456789abcdef');
    expect(last!.req.headers['openai-safety-identifier']).toBe('opaque-ref');
    const update = last!.received[0];
    expect(update).toMatchObject({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: 'POLICY',
        output_modalities: ['audio'],
        max_output_tokens: 4096,
        tools: [],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'ar' },
            turn_detection: { type: 'server_vad', create_response: false, interrupt_response: true },
          },
          output: { format: { type: 'audio/pcm', rate: 24000 } },
        },
      },
    });
    expect(last!.received.slice(1, 3)).toEqual([
      { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'سؤال سابق' }] } },
      { type: 'conversation.item.create', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'إجابة سابقة' }] } },
    ]);
    expect(events).toEqual([{ type: 'ready' }]);

    s.sendAudio('AAAA');
    s.respond();
    s.cancel();
    s.truncate('item_1', 1234.7);
    await wait(50);
    expect(last!.received.slice(3)).toEqual([
      { type: 'input_audio_buffer.append', audio: 'AAAA' },
      { type: 'response.create' },
      { type: 'response.cancel' },
      { type: 'conversation.item.truncate', item_id: 'item_1', content_index: 0, audio_end_ms: 1234 },
    ]);
    s.close();
  });

  it('maps server events and aggregates audio, text, cached and transcription usage', async () => {
    script = (m, ws) => {
      if (m.type !== 'session.update') return;
      send(ws, { type: 'session.updated', session: {} });
      send(ws, { type: 'input_audio_buffer.speech_started', item_id: 'u1', audio_start_ms: 10 });
      send(ws, { type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
      send(ws, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', content_index: 0, transcript: ' Hello ', usage: { type: 'tokens', input_tokens: 40, output_tokens: 6 } });
      send(ws, { type: 'conversation.item.input_audio_transcription.failed', item_id: 'u2' });
      send(ws, { type: 'response.output_audio.delta', item_id: 'a1', delta: 'BBBB' });
      send(ws, { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Hi' });
      send(ws, { type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'Hi there' });
      send(ws, {
        type: 'response.done',
        response: {
          status: 'completed',
          usage: { input_tokens: 330, output_tokens: 90, input_token_details: { text_tokens: 120, audio_tokens: 210, cached_tokens: 50, cached_tokens_details: { text_tokens: 20, audio_tokens: 30 } }, output_token_details: { text_tokens: 15, audio_tokens: 75 } },
        },
      });
      send(ws, { type: 'error', error: { type: 'invalid_request_error', code: 'response_cancel_not_active', message: 'nothing to cancel' } });
      send(ws, { type: 'error', error: { type: 'tokens', code: 'rate_limit_exceeded', message: 'slow down' } });
      send(ws, { type: 'response.done', response: { status: 'incomplete', status_details: { reason: 'content_filter' }, usage: {} } });
    };
    const events: RealtimeEvent[] = [];
    const s = await createOpenAiRealtimeProvider('sk-test-key-0123456789abcdef', 5000, url).connect({
      model: 'gpt-realtime-2.1',
      instructions: 'P',
      language: 'en',
      history: [],
      maxOutputTokens: 1024,
      requestId: 'r',
      endUserRef: 'x',
      onEvent: (e) => events.push(e),
    });
    await wait(100);
    expect(events).toEqual([
      { type: 'ready' },
      { type: 'speech_started', itemId: 'u1' },
      { type: 'speech_stopped' },
      { type: 'user_transcript', itemId: 'u1', text: 'Hello' },
      { type: 'user_transcript_failed', itemId: 'u2' },
      { type: 'audio', itemId: 'a1', data: 'BBBB' },
      { type: 'assistant_delta', itemId: 'a1', text: 'Hi' },
      { type: 'assistant_done', itemId: 'a1', text: 'Hi there' },
      { type: 'response_done', status: 'completed', refused: false },
      { type: 'error', kind: 'RATE_LIMIT', message: 'OpenAI Realtime error rate_limit_exceeded' },
      { type: 'response_done', status: 'incomplete', refused: true },
    ]);
    expect(s.usage()).toEqual({ textIn: 100, textOut: 15, cachedText: 20, audioIn: 180, audioOut: 75, cachedAudio: 30, transcribeIn: 40, transcribeOut: 6, transcriptionModel: 'gpt-4o-mini-transcribe' });
    s.close();
    await wait(50);
    expect(events.at(-1)).toEqual({ type: 'closed', expected: true });
  });

  it('maps a refused handshake to AUTH and never leaks the key into the error', async () => {
    reject401 = true;
    try {
      const err = await createOpenAiRealtimeProvider('sk-test-key-0123456789abcdef', 5000, url)
        .connect({ model: 'm', instructions: 'P', language: 'en', history: [], maxOutputTokens: 256, requestId: 'r', endUserRef: 'x', onEvent: () => undefined })
        .catch((e) => e);
      expect(err).toBeInstanceOf(AiProviderError);
      expect(err.kind).toBe('AUTH');
      expect(String(err.message)).not.toContain('sk-test');
    } finally {
      reject401 = false;
    }
  });

  it('answers a text turn for the evaluation suite (same realtime model)', async () => {
    script = (m, ws) => {
      if (m.type !== 'response.create') return;
      send(ws, { type: 'response.output_text.delta', delta: 'General ' });
      send(ws, { type: 'response.output_text.delta', delta: 'information.' });
      send(ws, { type: 'response.done', response: { status: 'completed', usage: { input_token_details: { text_tokens: 300, cached_tokens_details: { text_tokens: 100 } }, output_token_details: { text_tokens: 12 } } } });
    };
    const r = await createOpenAiRealtimeProvider('sk-test-key-0123456789abcdef', 5000, url).completeText({
      model: 'gpt-realtime-2.1',
      system: 'POLICY',
      systemExtra: 'EXTRA',
      messages: [{ role: 'user', content: 'What is a dressing?' }],
      maxOutputTokens: 512,
      effort: 'medium',
      requestId: 'e',
      endUserRef: 'dmw-evaluation',
    });
    expect(r).toEqual({ outcome: 'ANSWERED', text: 'General information.', servedModel: 'gpt-realtime-2.1', usage: { inputTokens: 200, outputTokens: 12, cacheReadTokens: 100 } });
    expect(last!.received[0]).toMatchObject({ type: 'session.update', session: { instructions: 'POLICY\n\nEXTRA', output_modalities: ['text'] } });
    expect(last!.received.at(-1)).toEqual({ type: 'response.create' });
  });

  it('usage helpers ignore malformed numbers and duration-billed transcription', () => {
    const u = emptyRealtimeUsage(null);
    addResponseUsage(u, { input_token_details: { text_tokens: -5, audio_tokens: 'many' }, output_token_details: { audio_tokens: 7.9 } });
    addTranscriptionUsage(u, { type: 'duration', seconds: 12 });
    expect(u).toMatchObject({ textIn: 0, audioIn: 0, audioOut: 7, transcribeIn: 0 });
  });
});

describe('provider set', () => {
  it('only OpenAI has a realtime adapter; the simulator never runs in production; no key → NOT_CONFIGURED', () => {
    const base = { ...process.env };
    const dev = createRealtimeProviders(loadEnv({ ...base, AI_OPENAI_API_KEY: '', AI_GEMINI_API_KEY: 'gemini-test-key-0123456789' }));
    expect(configuredRealtimeProviders(dev)).toEqual(['SIMULATED']);
    expect(dev.GEMINI.status).toBe('NOT_CONFIGURED');
    const withKey = createRealtimeProviders(loadEnv({ ...base, AI_OPENAI_API_KEY: 'sk-test-key-0123456789abcdef' }));
    expect(configuredRealtimeProviders(withKey)).toEqual(['OPENAI', 'SIMULATED']);
  });
});

describe('simulated realtime provider (development only)', () => {
  it('detects speech by level, labels its transcript and answers with a tone', async () => {
    const loud = Buffer.alloc(4800);
    for (let i = 0; i < 2400; i++) loud.writeInt16LE(i % 2 ? 8000 : -8000, i * 2);
    expect(pcmLevel(loud.toString('base64')).rms).toBeGreaterThan(0.2);
    expect(pcmLevel(Buffer.alloc(4800).toString('base64'))).toEqual({ rms: 0, ms: 100 });

    const events: RealtimeEvent[] = [];
    const s = await createSimulatedRealtimeProvider().connect({ model: 'simulated-voice', instructions: 'P', language: 'en', history: [], maxOutputTokens: 256, requestId: 'r', endUserRef: 'x', onEvent: (e) => events.push(e) });
    for (let i = 0; i < 5; i++) s.sendAudio(loud.toString('base64'));
    for (let i = 0; i < 7; i++) s.sendAudio(Buffer.alloc(4800).toString('base64'));
    await wait(100);
    const transcript = events.find((e) => e.type === 'user_transcript');
    expect(transcript).toMatchObject({ text: expect.stringContaining('[SIMULATED transcript') });
    s.respond();
    await wait(400);
    expect(events.filter((e) => e.type === 'audio').length).toBe(4);
    expect(events.find((e) => e.type === 'assistant_done')).toMatchObject({ text: expect.stringContaining('[SIMULATED') });
    expect(s.usage()).toMatchObject({ audioIn: 0, audioOut: 0 });
    s.close();
  });
});
