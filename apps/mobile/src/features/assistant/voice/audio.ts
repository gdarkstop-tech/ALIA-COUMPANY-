/**
 * Browser audio for the web test harness (the product ships as native apps — see audio.native.ts).
 * Microphone through getUserMedia (the browser's echo cancellation on), playback through Web Audio.
 */
import { BARGE_IN_LEVEL, floatToPcm16Base64, framer, pcm16Base64ToFloat, resample, rms, SAMPLE_RATE, type VoiceAudio } from './pcm';

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== 'undefined';
}

export function createVoiceAudio(): VoiceAudio {
  let stream: MediaStream | null = null;
  let input: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let output: AudioContext | null = null;
  let nextAt = 0;
  let sources: AudioBufferSourceNode[] = [];
  let current: { itemId: string; startedAt: number } | null = null;

  const isPlaying = () => Boolean(output && nextAt > output.currentTime + 0.02);

  return {
    async requestPermission() {
      if (!voiceSupported()) return 'unavailable';
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        return 'granted';
      } catch {
        return 'denied';
      }
    },
    async start(onFrame) {
      stream ??= await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      input = new AudioContext();
      output = new AudioContext({ sampleRate: SAMPLE_RATE });
      // Started from the person's tap; resume in case the browser created them suspended.
      await Promise.allSettled([input.resume(), output.resume()]);
      const source = input.createMediaStreamSource(stream);
      processor = input.createScriptProcessor(4096, 1, 1);
      const push = framer((frame) => {
        const level = rms(frame);
        // While the answer plays, quiet input is most likely its own echo: send silence instead.
        const send = isPlaying() && level < BARGE_IN_LEVEL ? new Float32Array(frame.length) : frame;
        onFrame(floatToPcm16Base64(send), level);
      });
      const rate = input.sampleRate;
      processor.onaudioprocess = (e) => push(resample(e.inputBuffer.getChannelData(0), rate));
      source.connect(processor);
      processor.connect(input.destination);
    },
    play(itemId, base64) {
      if (!output) return;
      const samples = pcm16Base64ToFloat(base64);
      if (!samples.length) return;
      const buffer = output.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const src = output.createBufferSource();
      src.buffer = buffer;
      src.connect(output.destination);
      const at = Math.max(output.currentTime, nextAt);
      if (!current || current.itemId !== itemId) current = { itemId, startedAt: at };
      src.start(at);
      nextAt = at + buffer.duration;
      sources.push(src);
      src.onended = () => (sources = sources.filter((s) => s !== src));
    },
    isPlaying,
    flush() {
      const heard = current && output ? { itemId: current.itemId, playedMs: Math.max(0, (output.currentTime - current.startedAt) * 1000) } : { itemId: null, playedMs: 0 };
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // already stopped
        }
      }
      sources = [];
      nextAt = output?.currentTime ?? 0;
      current = null;
      return heard;
    },
    async stop() {
      processor?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      await Promise.allSettled([input?.close(), output?.close()]);
      stream = null;
      input = null;
      output = null;
      processor = null;
    },
  };
}
