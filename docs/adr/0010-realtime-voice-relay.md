# ADR 0010 — Realtime voice through a server-side relay

- Status: accepted (2026-10-28)
- Extends: [ADR 0008](0008-ai-gateway.md), [ADR 0009](0009-model-registry-routing-evaluation.md)

## Context
Patients should be able to talk to the health assistant in Arabic or English, interrupt it, see a
transcript, and have their weekly voice minutes metered. Speech-to-speech models (OpenAI Realtime,
later Gemini Live or xAI voice) answer within a few hundred milliseconds. Two designs exist:

1. **Ephemeral client secrets**: the backend mints a short-lived provider credential and the app
   talks to the provider directly (WebRTC/WebSocket), optionally with a server "sideband".
2. **Server-side relay**: the app streams audio to our API; the API holds the provider connection
   with the business key and relays both ways.

With (1) the provider can answer before our server has seen the transcript, seconds are measured by
the client, and a stopped session depends on the client cooperating. The project's rules require
that emergencies never wait for a model, that the model is never the safety boundary, that metering
and hard stops are server-side, and that long-lived keys never reach the app.

## Decision
**Relay (2).** Wire format and flow:

1. `POST /v1/ai/voice/sessions` runs every gate in the database (`app.ai_voice_start` → `ai_reserve`:
   flag `ai.voice`, route, assistant consent, eligible approved model, budgets, weekly seconds, one
   live session per person) plus the separate **voice consent** (`AI_VOICE_PROCESSING`), reserves a
   first block of ≤ 30 s, and returns a **single-use 256-bit ticket** valid for 60 s. Only its
   SHA-256 is stored.
2. The app opens `wss://…/v1/ai/voice/sessions/:id/stream` with subprotocols
   `dmw.voice.v1, ticket.<ticket>`. The ticket never appears in a URL; the
   `sec-websocket-protocol` header is redacted from logs; the server never echoes it. Browsers must
   come from an allowed origin.
3. Audio: 16-bit mono PCM at 24 kHz, base64 in JSON frames (≤ ~1 s each, ≤ 2.5× real-time rate).
4. The provider's VAD detects turns but **never answers on its own** (`create_response: false`).
   Each transcribed turn is checked by the deterministic emergency detector first; an emergency
   gets the fixed guidance, the model is not asked, and the call ends. Otherwise the relay asks for
   an answer. The person speaking over the answer cancels it (`interrupt_response`) and the app
   reports how much was heard so the provider truncates the rest.
5. Metering: wall-clock seconds of the live stream. Before a block runs out the relay asks the
   database for the next (`app.ai_voice_extend`), which re-checks allowance, consent, flag/route and
   budget. No block → the stream stops at the reserved total. Sessions last ≤ 10 minutes.
6. Settlement (`app.ai_voice_settle`): seconds used and provider-reported text/audio/cached tokens
   priced from the registry (new audio-price columns), plus input-transcription tokens priced from
   the transcription model's row (marked *estimated* while unverified). Abandoned sessions are
   settled by a reaper from their last heartbeat.
7. Only **text** transcripts are stored, as messages of the person's conversation (`channel =
   'VOICE'`), through a definer function; audio is never stored or logged.
8. Evaluation: voice models are evaluated with the same suite in text mode over the same realtime
   interface, under the voice policy (its own policy version), and need their own clinical approval
   for `patient.voice`.
9. Native: `react-native-audio-api` only in development / preview builds; production builds do not
   link it, declare no microphone purpose string and block `RECORD_AUDIO` (release check). The
   server flag is the second, independent switch.

## Consequences
- One extra hop (app → API → provider): some added latency, and API instances must handle
  long-lived sockets (sticky load balancing not needed: the session lives on one connection).
- Gemini Live and xAI voice need their own adapters; until then they are `NOT_CONFIGURED` for voice.
- No retrieval-augmented answers in voice yet (spoken citations need a design); voice uses the policy
  only.
- Native audio, echo behaviour and Arabic speech recognition quality are **not verified on devices**
  in this build; that, and an Arabic dialect evaluation, are launch prerequisites.
