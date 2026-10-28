/**
 * Native audio (iOS / Android) through react-native-audio-api. The native module is linked only in
 * builds that ship voice (development and preview variants — app.config.ts, react-native.config.js);
 * production store builds do not contain it and do not request the microphone, so everything here
 * is loaded lazily and voiceSupported() is false there.
 *
 * NOT verified on a device in this build (no simulator or phone was available): echo behaviour,
 * Bluetooth routing and Android sample rates need device testing before launch.
 */
import Constants from 'expo-constants';
import { BARGE_IN_LEVEL, floatToPcm16Base64, framer, pcm16Base64ToFloat, resample, rms, SAMPLE_RATE, type VoiceAudio } from './pcm';

type AudioApi = typeof import('react-native-audio-api');
let mod: AudioApi | null | undefined;
function audioApi(): AudioApi | null {
  if (mod !== undefined) return mod;
  if (!Constants.expoConfig?.extra?.voiceEnabled) return (mod = null);
  try {
    mod = require('react-native-audio-api') as AudioApi;
  } catch {
    mod = null;
  }
  return mod;
}

export function voiceSupported(): boolean {
  return audioApi() !== null;
}

export function createVoiceAudio(): VoiceAudio {
  const a = audioApi();
  let recorder: InstanceType<AudioApi['AudioRecorder']> | null = null;
  let ctx: InstanceType<AudioApi['AudioContext']> | null = null;
  let queue: ReturnType<InstanceType<AudioApi['AudioContext']>['createBufferQueueSource']> | null = null;
  // Playback bookkeeping: which answer each queued buffer belongs to, and how much has ended.
  const buffers = new Map<string, { itemId: string; ms: number }>();
  let pending = 0;
  let heard: { itemId: string | null; ms: number } = { itemId: null, ms: 0 };

  function ensureQueue() {
    if (!a || !ctx || queue) return;
    queue = ctx.createBufferQueueSource();
    queue.connect(ctx.destination);
    queue.onBufferEnded = (e) => {
      const b = buffers.get(e.bufferId);
      buffers.delete(e.bufferId);
      pending = Math.max(0, pending - 1);
      if (b) heard = heard.itemId === b.itemId ? { itemId: b.itemId, ms: heard.ms + b.ms } : { itemId: b.itemId, ms: b.ms };
    };
    queue.start();
  }

  return {
    async requestPermission() {
      if (!a) return 'unavailable';
      const status = await a.AudioManager.requestRecordingPermissions();
      return status === 'Granted' ? 'granted' : 'denied';
    },
    async start(onFrame) {
      if (!a) throw new Error('VOICE_UNSUPPORTED');
      // Voice-chat session: echo cancellation on iOS, speaker by default, Bluetooth headsets allowed.
      a.AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'voiceChat', iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'] });
      await a.AudioManager.setAudioSessionActivity(true);
      ctx = new a.AudioContext({ sampleRate: SAMPLE_RATE });
      recorder = new a.AudioRecorder();
      const push = framer((frame) => {
        const level = rms(frame);
        const send = pending > 0 && level < BARGE_IN_LEVEL ? new Float32Array(frame.length) : frame;
        onFrame(floatToPcm16Base64(send), level);
      });
      const ready = recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: SAMPLE_RATE / 10, channelCount: 1 }, ({ buffer }) => {
        push(resample(buffer.getChannelData(0), buffer.sampleRate));
      });
      if (ready.status === 'error') throw new Error(ready.message);
      const started = await recorder.start();
      if (started.status === 'error') throw new Error(started.message);
    },
    play(itemId, base64) {
      if (!a || !ctx) return;
      ensureQueue();
      const samples = pcm16Base64ToFloat(base64);
      if (!samples.length || !queue) return;
      const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const id = queue.enqueueBuffer(buffer);
      buffers.set(id, { itemId, ms: (samples.length / SAMPLE_RATE) * 1000 });
      pending += 1;
    },
    isPlaying: () => pending > 0,
    flush() {
      const out = { itemId: heard.itemId ?? buffers.values().next().value?.itemId ?? null, playedMs: heard.ms };
      queue?.clearBuffers();
      buffers.clear();
      pending = 0;
      heard = { itemId: null, ms: 0 };
      return out;
    },
    async stop() {
      try {
        recorder?.clearOnAudioReady();
        await recorder?.stop();
      } catch {
        // already stopped
      }
      queue?.stop();
      await ctx?.close().catch(() => undefined);
      await a?.AudioManager.setAudioSessionActivity(false).catch(() => undefined);
      recorder = null;
      queue = null;
      ctx = null;
    },
  };
}
