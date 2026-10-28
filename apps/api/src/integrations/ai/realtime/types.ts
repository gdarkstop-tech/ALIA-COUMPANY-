/**
 * Realtime (speech-to-speech) provider contracts. Same rules as the text gateway: the business key
 * stays in the backend, adapters are replaceable, and nothing outside src/integrations/ai knows the
 * vendor's wire format. The API relays the app's audio to a provider session; the app never
 * connects to a provider.
 */
import type { AiErrorKind, AiProviderCode, AiRequest, AiResult, AiTurn } from '../types';

/** Audio is 16-bit little-endian mono PCM at 24 kHz, base64 — the same on both sides of the relay. */
export const REALTIME_SAMPLE_RATE = 24_000;

/** Provider-reported token counts for a whole session (no content). Cached tokens are separate. */
export type RealtimeUsage = {
  textIn: number;
  textOut: number;
  cachedText: number;
  audioIn: number;
  audioOut: number;
  cachedAudio: number;
  /** Input-transcription tokens (the person's speech → text), billed by the transcription model. */
  transcribeIn: number;
  transcribeOut: number;
  transcriptionModel: string | null;
};
export const emptyRealtimeUsage = (transcriptionModel: string | null = null): RealtimeUsage => ({
  textIn: 0,
  textOut: 0,
  cachedText: 0,
  audioIn: 0,
  audioOut: 0,
  cachedAudio: 0,
  transcribeIn: 0,
  transcribeOut: 0,
  transcriptionModel,
});

export type RealtimeEvent =
  /** Session configured: audio may flow. */
  | { type: 'ready' }
  | { type: 'speech_started'; itemId: string | null }
  | { type: 'speech_stopped' }
  /** The person's turn, transcribed. The relay decides whether the model may answer. */
  | { type: 'user_transcript'; itemId: string | null; text: string }
  | { type: 'user_transcript_failed'; itemId: string | null }
  | { type: 'audio'; itemId: string; data: string }
  | { type: 'assistant_delta'; itemId: string; text: string }
  | { type: 'assistant_done'; itemId: string; text: string }
  /** End of one answer. `refused` = the provider's own safety system declined. */
  | { type: 'response_done'; status: 'completed' | 'cancelled' | 'failed' | 'incomplete'; refused: boolean }
  | { type: 'error'; kind: AiErrorKind; message: string }
  /** The provider connection closed (expected or not). */
  | { type: 'closed'; expected: boolean };

export type RealtimeConnectOptions = {
  model: string;
  /** Our fixed policy (and validated preferences). Never contains the person's words. */
  instructions: string;
  language: 'ar' | 'en';
  /** Earlier turns of the conversation, oldest first (text). */
  history: AiTurn[];
  maxOutputTokens: number;
  requestId: string;
  endUserRef: string;
  onEvent: (e: RealtimeEvent) => void;
};

export interface RealtimeSession {
  sendAudio(base64Pcm16: string): void;
  /** Generate an answer to the person's last (transcribed) turn. */
  respond(): void;
  /** Stop the answer in progress. */
  cancel(): void;
  /** The person heard only `audioEndMs` of this answer: forget the rest. */
  truncate(itemId: string, audioEndMs: number): void;
  close(): void;
  usage(): RealtimeUsage;
}

export interface RealtimeVoiceProvider {
  readonly code: AiProviderCode;
  /** CONFIGURED only when the business-owned key is present AND a realtime adapter exists. */
  readonly status: 'CONFIGURED' | 'NOT_CONFIGURED';
  connect(o: RealtimeConnectOptions): Promise<RealtimeSession>;
  /** One text turn over the realtime interface, for the evaluation suite (same model, same policy). */
  completeText(req: AiRequest): Promise<AiResult>;
}
