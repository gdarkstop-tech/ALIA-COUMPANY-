import { createSimulatedProvider } from '../simulated';
import { emptyRealtimeUsage, REALTIME_SAMPLE_RATE, type RealtimeConnectOptions, type RealtimeSession, type RealtimeVoiceProvider } from './types';

const SPEECH_RMS = 0.02;
const SILENCE_MS = 600;

/** Root-mean-square level (0–1) of base64 16-bit little-endian PCM, and its duration in ms. */
export function pcmLevel(base64: string): { rms: number; ms: number } {
  const b = Buffer.from(base64, 'base64');
  const n = Math.floor(b.length / 2);
  if (!n) return { rms: 0, ms: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = b.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return { rms: Math.sqrt(sum / n), ms: (n / REALTIME_SAMPLE_RATE) * 1000 };
}

/** A short, quiet tone as base64 PCM (what the simulated assistant "says"). */
function tone(ms: number, hz = 440): string {
  const n = Math.round((REALTIME_SAMPLE_RATE * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / REALTIME_SAMPLE_RATE) * 3000), i * 2);
  return b.toString('base64');
}

/**
 * Development / automated-test stand-in, refused in production. A simple level detector stands in
 * for voice activity detection; the "transcript" only describes how much audio arrived and the
 * answer is a labelled tone — no speech recognition, no health information.
 */
export function createSimulatedRealtimeProvider(): RealtimeVoiceProvider {
  const text = createSimulatedProvider();
  return {
    code: 'SIMULATED',
    status: 'CONFIGURED',
    async connect(o: RealtimeConnectOptions): Promise<RealtimeSession> {
      let speaking = false;
      let speechMs = 0;
      let silenceMs = 0;
      let turn = 0;
      let timers: NodeJS.Timeout[] = [];
      let closed = false;
      const later = (ms: number, fn: () => void) => timers.push(setTimeout(() => !closed && fn(), ms));
      setImmediate(() => !closed && o.onEvent({ type: 'ready' }));

      const session: RealtimeSession = {
        sendAudio(data) {
          const { rms, ms } = pcmLevel(data);
          if (rms >= SPEECH_RMS) {
            silenceMs = 0;
            speechMs += ms;
            if (!speaking) {
              speaking = true;
              session.cancel();
              o.onEvent({ type: 'speech_started', itemId: `sim-user-${turn + 1}` });
            }
          } else if (speaking) {
            silenceMs += ms;
            if (silenceMs >= SILENCE_MS) {
              speaking = false;
              turn += 1;
              const heard = (speechMs / 1000).toFixed(1);
              speechMs = 0;
              o.onEvent({ type: 'speech_stopped' });
              later(50, () => o.onEvent({ type: 'user_transcript', itemId: `sim-user-${turn}`, text: `[SIMULATED transcript — development only] ${heard} s of speech received.` }));
            }
          }
        },
        respond() {
          const itemId = `sim-assistant-${turn}`;
          const reply = '[SIMULATED — development only, not a real AI answer] I heard you. A real deployment answers here with general information only.';
          later(30, () => o.onEvent({ type: 'assistant_delta', itemId, text: reply }));
          for (let i = 0; i < 4; i++) later(60 + i * 40, () => o.onEvent({ type: 'audio', itemId, data: tone(150) }));
          later(260, () => o.onEvent({ type: 'assistant_done', itemId, text: reply }));
          later(280, () => o.onEvent({ type: 'response_done', status: 'completed', refused: false }));
        },
        cancel() {
          if (!timers.length) return;
          timers.forEach(clearTimeout);
          timers = [];
          o.onEvent({ type: 'response_done', status: 'cancelled', refused: false });
        },
        truncate() {},
        close() {
          closed = true;
          timers.forEach(clearTimeout);
          o.onEvent({ type: 'closed', expected: true });
        },
        usage: () => emptyRealtimeUsage(null),
      };
      return session;
    },
    completeText: (req) => text.complete(req),
  };
}
