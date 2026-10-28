import WebSocket from 'ws';
import { AiProviderError, fullSystem, type AiErrorKind, type AiResult } from '../types';
import { emptyRealtimeUsage, REALTIME_SAMPLE_RATE, type RealtimeConnectOptions, type RealtimeEvent, type RealtimeSession, type RealtimeUsage, type RealtimeVoiceProvider } from './types';

export const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
/** Transcribes the person's speech (emergency check + transcript); priced from its registry row. */
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const VOICE = 'marin';

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

function handshakeError(status: number | undefined): AiProviderError {
  const kind: AiErrorKind = status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : status === 400 || status === 404 ? 'BAD_REQUEST' : status && status >= 500 ? 'OVERLOADED' : 'UPSTREAM';
  return new AiProviderError('OPENAI', kind, `OpenAI Realtime refused the connection${status ? ` (${status})` : ''}`);
}

/** Adds one `response.done` usage block (OpenAI counts cached tokens inside the input totals). */
export function addResponseUsage(u: RealtimeUsage, usage: unknown): void {
  const inD = obj(obj(usage).input_token_details);
  const cachedD = obj(inD.cached_tokens_details);
  const outD = obj(obj(usage).output_token_details);
  const cachedText = num(cachedD.text_tokens);
  const cachedAudio = num(cachedD.audio_tokens);
  u.textIn += Math.max(0, num(inD.text_tokens) - cachedText);
  u.audioIn += Math.max(0, num(inD.audio_tokens) - cachedAudio);
  u.cachedText += cachedText;
  u.cachedAudio += cachedAudio;
  u.textOut += num(outD.text_tokens);
  u.audioOut += num(outD.audio_tokens);
}

/** Adds the usage of one input transcription (token-billed; duration-billed usage carries no tokens). */
export function addTranscriptionUsage(u: RealtimeUsage, usage: unknown): void {
  const x = obj(usage);
  if (x.type !== 'tokens') return;
  u.transcribeIn += num(x.input_tokens);
  u.transcribeOut += num(x.output_tokens);
}

/**
 * OpenAI Realtime API over a server-side WebSocket (`wss://api.openai.com/v1/realtime?model=…`,
 * business key as a bearer token, `OpenAI-Safety-Identifier` for abuse monitoring). Server VAD
 * detects turns but never answers on its own (`create_response: false`): the relay first checks
 * the transcript for emergencies, then asks for an answer. The person speaking cancels an answer
 * in progress (`interrupt_response: true`). Event names follow the GA Realtime reference; this
 * adapter is covered only by tests against a local stand-in server, never the live API.
 */
export function createOpenAiRealtimeProvider(apiKey: string | undefined, timeoutMs: number, baseURL = OPENAI_REALTIME_URL): RealtimeVoiceProvider {
  if (!apiKey) return notConfiguredRealtime('OPENAI');

  function open(model: string, endUserRef: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${baseURL}?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Safety-Identifier': endUserRef },
        handshakeTimeout: Math.min(timeoutMs, 15_000),
      });
      ws.once('open', () => resolve(ws));
      ws.once('unexpected-response', (_req, res) => {
        reject(handshakeError(res.statusCode));
        ws.terminate();
      });
      ws.once('error', (e) => reject(/timeout/i.test(e.message) ? new AiProviderError('OPENAI', 'TIMEOUT', 'OpenAI Realtime timed out') : new AiProviderError('OPENAI', 'NETWORK', 'Could not reach OpenAI Realtime')));
    });
  }

  const historyItems = (history: { role: 'user' | 'assistant'; content: string }[]) =>
    history.map((t) => ({
      type: 'conversation.item.create',
      item: { type: 'message', role: t.role, content: [{ type: t.role === 'user' ? 'input_text' : 'output_text', text: t.content }] },
    }));

  return {
    code: 'OPENAI',
    status: 'CONFIGURED',

    async connect(o: RealtimeConnectOptions): Promise<RealtimeSession> {
      const ws = await open(o.model, o.endUserRef);
      const usage = emptyRealtimeUsage(OPENAI_TRANSCRIPTION_MODEL);
      let closing = false;
      let ready = false;
      const send = (e: Json) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
      };

      ws.on('message', (raw) => {
        let e: Json;
        try {
          e = JSON.parse(raw.toString()) as Json;
        } catch {
          return;
        }
        const emit = (x: RealtimeEvent) => o.onEvent(x);
        switch (e.type) {
          case 'session.updated':
            if (!ready) {
              ready = true;
              emit({ type: 'ready' });
            }
            break;
          case 'input_audio_buffer.speech_started':
            emit({ type: 'speech_started', itemId: str(e.item_id) || null });
            break;
          case 'input_audio_buffer.speech_stopped':
            emit({ type: 'speech_stopped' });
            break;
          case 'conversation.item.input_audio_transcription.completed':
            addTranscriptionUsage(usage, e.usage);
            emit({ type: 'user_transcript', itemId: str(e.item_id) || null, text: str(e.transcript).trim() });
            break;
          case 'conversation.item.input_audio_transcription.failed':
            emit({ type: 'user_transcript_failed', itemId: str(e.item_id) || null });
            break;
          case 'response.output_audio.delta':
            emit({ type: 'audio', itemId: str(e.item_id), data: str(e.delta) });
            break;
          case 'response.output_audio_transcript.delta':
            emit({ type: 'assistant_delta', itemId: str(e.item_id), text: str(e.delta) });
            break;
          case 'response.output_audio_transcript.done':
            emit({ type: 'assistant_done', itemId: str(e.item_id), text: str(e.transcript).trim() });
            break;
          case 'response.done': {
            const r = obj(e.response);
            addResponseUsage(usage, r.usage);
            const status = (['completed', 'cancelled', 'failed', 'incomplete'] as const).find((s) => s === r.status) ?? 'failed';
            const reason = str(obj(r.status_details).reason);
            emit({ type: 'response_done', status, refused: reason === 'content_filter' });
            break;
          }
          case 'error': {
            const err = obj(e.error);
            const code = str(err.code);
            // Cancelling when nothing is playing is harmless (the person spoke over silence).
            if (code === 'response_cancel_not_active') break;
            emit({ type: 'error', kind: code === 'rate_limit_exceeded' ? 'RATE_LIMIT' : 'UPSTREAM', message: `OpenAI Realtime error ${code || str(err.type)}`.trim() });
            break;
          }
          default:
            break;
        }
      });
      ws.on('close', () => o.onEvent({ type: 'closed', expected: closing }));
      ws.on('error', () => undefined); // surfaced through 'close'

      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: o.instructions,
          output_modalities: ['audio'],
          max_output_tokens: Math.min(4096, o.maxOutputTokens),
          tools: [],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
              noise_reduction: { type: 'near_field' },
              transcription: { model: OPENAI_TRANSCRIPTION_MODEL, language: o.language },
              turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600, create_response: false, interrupt_response: true },
            },
            output: { format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE }, voice: VOICE },
          },
        },
      });
      for (const item of historyItems(o.history)) send(item);

      return {
        sendAudio: (data) => send({ type: 'input_audio_buffer.append', audio: data }),
        respond: () => send({ type: 'response.create' }),
        cancel: () => send({ type: 'response.cancel' }),
        truncate: (itemId, audioEndMs) => send({ type: 'conversation.item.truncate', item_id: itemId, content_index: 0, audio_end_ms: Math.max(0, Math.floor(audioEndMs)) }),
        close: () => {
          closing = true;
          ws.close(1000);
        },
        usage: () => ({ ...usage }),
      };
    },

    async completeText(req): Promise<AiResult> {
      const ws = await open(req.model, req.endUserRef);
      const usage = emptyRealtimeUsage(null);
      return new Promise<AiResult>((resolve, reject) => {
        let text = '';
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new AiProviderError('OPENAI', 'TIMEOUT', 'OpenAI Realtime timed out'));
        }, timeoutMs);
        const finish = (fn: () => void) => {
          clearTimeout(timer);
          ws.close(1000);
          fn();
        };
        ws.on('message', (raw) => {
          let e: Json;
          try {
            e = JSON.parse(raw.toString()) as Json;
          } catch {
            return;
          }
          if (e.type === 'response.output_text.delta') text += str(e.delta);
          else if (e.type === 'error') finish(() => reject(new AiProviderError('OPENAI', 'UPSTREAM', `OpenAI Realtime error ${str(obj(e.error).code)}`.trim())));
          else if (e.type === 'response.done') {
            const r = obj(e.response);
            addResponseUsage(usage, r.usage);
            const reason = str(obj(r.status_details).reason);
            const u = { inputTokens: usage.textIn, outputTokens: usage.textOut, cacheReadTokens: usage.cachedText };
            finish(() =>
              resolve(
                reason === 'content_filter'
                  ? { outcome: 'REFUSED', text: '', servedModel: req.model, usage: u, refusalCategory: null }
                  : { outcome: r.status === 'incomplete' && reason === 'max_output_tokens' ? 'TRUNCATED' : 'ANSWERED', text: text.trim(), servedModel: req.model, usage: u },
              ),
            );
          }
        });
        ws.on('close', () => {
          clearTimeout(timer);
          reject(new AiProviderError('OPENAI', 'NETWORK', 'OpenAI Realtime closed the connection'));
        });
        const send = (e: Json) => ws.send(JSON.stringify(e));
        send({ type: 'session.update', session: { type: 'realtime', instructions: fullSystem(req), output_modalities: ['text'], max_output_tokens: Math.min(4096, req.maxOutputTokens), tools: [] } });
        for (const item of historyItems(req.messages)) send(item);
        send({ type: 'response.create' });
      });
    },
  };
}

export const notConfiguredRealtime = (code: RealtimeVoiceProvider['code']): RealtimeVoiceProvider => ({
  code,
  status: 'NOT_CONFIGURED',
  connect: async () => {
    throw new AiProviderError(code, 'NOT_CONFIGURED', `${code} realtime voice is not configured`);
  },
  completeText: async () => {
    throw new AiProviderError(code, 'NOT_CONFIGURED', `${code} realtime voice is not configured`);
  },
});
