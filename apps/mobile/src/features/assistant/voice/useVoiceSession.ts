import type { AiMessageKind, AiVoiceClientEvent, AiVoiceEndReason, AiVoiceServerEvent } from '@ghayarly/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { createVoiceAudio } from './audio';
import type { VoiceAudio } from './pcm';

export type VoicePhase = 'idle' | 'starting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'ended';
export type VoiceLine = { key: string; role: 'user' | 'assistant'; text: string; kind: AiMessageKind; final: boolean };

/**
 * One live voice conversation. The app only captures and plays audio: the server holds the
 * provider connection, checks every turn for emergencies, meters seconds and stops the stream.
 */
export function useVoiceSession() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [emergency, setEmergency] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<AiVoiceEndReason | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notUnderstood, setNotUnderstood] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const audio = useRef<VoiceAudio | null>(null);
  const endedRef = useRef(false);

  const sendEvent = (e: AiVoiceClientEvent) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(e));
  };
  const upsert = (key: string, role: VoiceLine['role'], text: string, kind: AiMessageKind, final: boolean, append = false) =>
    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i < 0) return [...prev, { key, role, text, kind, final }];
      const next = [...prev];
      next[i] = { ...next[i]!, text: append ? next[i]!.text + text : text, kind, final };
      return next;
    });

  const teardown = useCallback(async (reason: AiVoiceEndReason | null) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const a = audio.current;
    audio.current = null;
    a?.flush();
    await a?.stop().catch(() => undefined);
    ws.current = null;
    setLevel(0);
    setPhase('ended');
    if (reason) setEndReason(reason);
    // The transcript and the weekly allowance changed on the server.
    void qc.invalidateQueries({ queryKey: ['ai'] });
  }, [qc]);

  const onServerEvent = useCallback((e: AiVoiceServerEvent) => {
    const a = audio.current;
    switch (e.type) {
      case 'ready':
        setRemaining(e.remainingSeconds);
        setSimulated(e.simulated);
        setPhase('listening');
        return;
      case 'speech_started':
        setNotUnderstood(false);
        // Barge-in: the person speaks over the answer → stop it and tell the server what was heard.
        if (a?.isPlaying()) {
          const heard = a.flush();
          sendEvent({ type: 'interrupt', itemId: heard.itemId, playedMs: heard.playedMs });
        }
        setPhase('hearing');
        return;
      case 'speech_stopped':
        setPhase('thinking');
        return;
      case 'user_transcript':
        upsert(e.messageId ?? `u-${Date.now()}`, 'user', e.text, 'MESSAGE', true);
        setPhase('thinking');
        return;
      case 'not_understood':
        setNotUnderstood(true);
        setPhase('listening');
        return;
      case 'audio':
        a?.play(e.itemId, e.data);
        setPhase('speaking');
        return;
      case 'assistant_delta':
        upsert(e.itemId, 'assistant', e.text, 'MESSAGE', false, true);
        return;
      case 'assistant_done':
        upsert(e.itemId, 'assistant', e.text, e.kind, true);
        if (!a?.isPlaying()) setPhase('listening');
        return;
      case 'emergency':
        audio.current?.flush();
        setEmergency(e.text);
        return;
      case 'usage':
        setRemaining(e.remainingSeconds);
        return;
      case 'ended':
        void teardown(e.reason);
        return;
      case 'error':
        setError(e.code);
        return;
    }
  }, [teardown]);

  const start = useCallback(async (opts: { conversationId?: string } = {}) => {
    setError(null);
    setEndReason(null);
    setEmergency(null);
    setNotUnderstood(false);
    setPhase('starting');
    endedRef.current = false;
    const a = createVoiceAudio();
    audio.current = a;
    try {
      const permission = await a.requestPermission();
      if (permission !== 'granted') throw new Error(permission === 'denied' ? 'MIC_DENIED' : 'VOICE_UNSUPPORTED');
      const s = await api.ai.startVoice(opts.conversationId ? { conversationId: opts.conversationId } : {});
      setConversationId(s.conversationId);
      setRemaining(s.allowance?.remaining ?? null);
      // The ticket travels as a subprotocol so it never appears in a URL or a log line.
      const socket = new WebSocket(api.ai.voiceStreamUrl(s.streamPath), [s.protocol, `ticket.${s.ticket}`]);
      ws.current = socket;
      socket.onmessage = (m) => {
        let e: AiVoiceServerEvent;
        try {
          e = JSON.parse(String(m.data)) as AiVoiceServerEvent;
        } catch {
          return;
        }
        if (e.type === 'ready') {
          a.start((data, lvl) => {
            setLevel(lvl);
            sendEvent({ type: 'audio', data });
          }).catch((err: unknown) => {
            setError(err);
            sendEvent({ type: 'end' });
          });
        }
        onServerEvent(e);
      };
      socket.onerror = () => setError('NETWORK_ERROR');
      socket.onclose = () => void teardown(endedRef.current ? null : 'DISCONNECTED');
    } catch (e) {
      setError(e instanceof Error && /^(MIC_DENIED|VOICE_UNSUPPORTED)$/.test(e.message) ? e.message : e);
      await teardown(null);
    }
  }, [onServerEvent, teardown]);

  /** Stop the answer now (the person tapped "stop"). */
  const interrupt = useCallback(() => {
    const heard = audio.current?.flush();
    if (heard) sendEvent({ type: 'interrupt', itemId: heard.itemId, playedMs: heard.playedMs });
    setPhase('listening');
  }, []);

  const end = useCallback(() => {
    sendEvent({ type: 'end' });
  }, []);

  // Leaving the screen ends the call (the server settles the seconds used).
  useEffect(
    () => () => {
      sendEvent({ type: 'end' });
      ws.current?.close();
      void audio.current?.stop();
    },
    [],
  );

  return { phase, lines, level, remaining, emergency, endReason, error, notUnderstood, simulated, conversationId, start, interrupt, end };
}
