/**
 * PCM helpers shared by the native and web audio layers. The voice stream carries 16-bit
 * little-endian mono PCM at 24 kHz, base64 (AI_VOICE_SAMPLE_RATE). No Buffer on React Native, so
 * base64 is done by hand.
 */
import { AI_VOICE_SAMPLE_RATE } from '@ghayarly/shared';

export const SAMPLE_RATE = AI_VOICE_SAMPLE_RATE;
/** While the assistant is speaking, only speech this loud counts as the person interrupting (echo guard). */
export const BARGE_IN_LEVEL = 0.08;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  if (i < bytes.length) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=') + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (LOOKUP[clean.charCodeAt(i)]! << 18) | (LOOKUP[clean.charCodeAt(i + 1)]! << 12) | ((LOOKUP[clean.charCodeAt(i + 2)] ?? 0) << 6) | (LOOKUP[clean.charCodeAt(i + 3)] ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Linear resampling of mono float samples (good enough for speech at these rates). */
export function resample(input: Float32Array, fromRate: number, toRate = SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (input[j] ?? 0) * (1 - f) + (input[j + 1] ?? input[j] ?? 0) * f;
  }
  return out;
}

export function floatToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytesToBase64(bytes);
}

export function pcm16Base64ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Collects resampled audio and hands out ~100 ms frames. */
export function framer(onFrame: (frame: Float32Array) => void, frameSamples = SAMPLE_RATE / 10) {
  let buf = new Float32Array(0);
  return (chunk: Float32Array) => {
    const next = new Float32Array(buf.length + chunk.length);
    next.set(buf);
    next.set(chunk, buf.length);
    buf = next;
    while (buf.length >= frameSamples) {
      onFrame(buf.slice(0, frameSamples));
      buf = buf.slice(frameSamples);
    }
  };
}

export type VoiceAudio = {
  /** Microphone permission; asks the person if it was never asked. */
  requestPermission(): Promise<'granted' | 'denied' | 'unavailable'>;
  /** Starts the microphone: ~100 ms frames of 24 kHz PCM16 (base64) and a 0–1 level for the visuals. */
  start(onFrame: (base64: string, level: number) => void): Promise<void>;
  /** Queues part of the assistant's spoken answer. */
  play(itemId: string, base64: string): void;
  isPlaying(): boolean;
  /** Stops playback now (the person interrupted); returns how much of that answer they heard. */
  flush(): { itemId: string | null; playedMs: number };
  stop(): Promise<void>;
};
