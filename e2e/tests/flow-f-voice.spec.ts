import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { apiSession, byId, createSelfProfile, DEMO_PASSWORD, shot, signInMobile } from './helpers';

const TESTER = 'ai.tester@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
type Candidate = { id: string; tier: string; modelId: string };
type Route = { key: string; enabled: boolean; candidates: Candidate[] };

/**
 * Flow F4 — Realtime voice, pre-launch (web harness only; native audio is not exercised here).
 * `ai.voice` stays OFF, so only the INTERNAL_TEST account can use it; an admin routes patient.voice
 * to the development simulator. Chromium's fake microphone supplies audio; the simulator detects it
 * by level and answers with a labelled tone. Proves: separate voice consent, ticketed stream through
 * the API relay, transcripts saved as conversation messages, seconds metered.
 */
/**
 * A synthetic "speaker" for Chromium's fake microphone (looped): 1 s of an amplitude-modulated
 * harmonic tone, then 1.5 s of silence — enough for the simulator's level detector to see a turn
 * begin and end. Generated at run time; no audio files are committed.
 */
function syntheticSpeechWav(): string {
  const rate = 48_000;
  const samples = Math.round(rate * 2.5);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const v = t < 1 ? (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * (Math.sin(2 * Math.PI * 220 * t) + 0.6 * Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t)) * 0.25 : 0;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const file = join(tmpdir(), 'dmw-e2e-synthetic-speech.wav');
  writeFileSync(file, Buffer.concat([header, data]));
  return file;
}

// Chromium's fake microphone, fed with the synthetic speaker, instead of a real device.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${syntheticSpeechWav()}`, '--autoplay-policy=no-user-gesture-required'],
  },
});

test.describe('Flow F4 — voice conversation (internal test account, simulated realtime model)', () => {

  let admin: Awaited<ReturnType<typeof apiSession>>;
  let tester: Awaited<ReturnType<typeof apiSession>>;
  let original: Route;
  let added: string[] = [];

  const setConsent = async (type: 'AI_ASSISTANT_PROCESSING' | 'AI_VOICE_PROCESSING', granted: boolean) => {
    const state = await (await tester.get('/v1/me/consents')).json();
    const c = state.consents.find((x: { type: string }) => x.type === type);
    const res = await tester.post('/v1/me/consents', { data: { consents: [{ type: c.type, version: c.currentVersion, granted }], source: 'web', locale: 'en' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  };

  test.beforeAll(async () => {
    admin = await apiSession(ADMIN, DEMO_PASSWORD);
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    const cc = await (await admin.get('/v1/admin/ai/control-centre')).json();
    original = cc.routes.find((r: Route) => r.key === 'patient.voice');
    const simulated = cc.models.find((m: { provider: string; modelId: string }) => m.provider === 'SIMULATED' && m.modelId === 'simulated-voice');
    expect(simulated, 'simulated voice model seeded').toBeTruthy();
    for (const tier of ['BASIC', 'ADVANCED', 'PREMIUM']) {
      const res = await admin.post('/v1/admin/ai/routes/patient.voice/candidates', { data: { tier, modelId: simulated.id, priority: 1 } });
      expect(res.ok(), await res.text()).toBeTruthy();
      added.push((await res.json()).routes.find((r: Route) => r.key === 'patient.voice').candidates.find((c: Candidate) => c.tier === tier && c.modelId === simulated.id).id);
    }
    expect((await admin.patch('/v1/admin/ai/routes/patient.voice', { data: { enabled: true } })).ok()).toBeTruthy();
    await setConsent('AI_ASSISTANT_PROCESSING', true);
    await setConsent('AI_VOICE_PROCESSING', false);
    // The home screen needs a profile of their own.
    await createSelfProfile(tester, 'AI Internal Tester');
  });

  test.afterAll(async () => {
    for (const id of added) await admin.delete(`/v1/admin/ai/candidates/${id}`);
    added = [];
    await admin.patch('/v1/admin/ai/routes/patient.voice', { data: { enabled: original.enabled } });
    await setConsent('AI_VOICE_PROCESSING', false);
    await setConsent('AI_ASSISTANT_PROCESSING', false);
  });

  test('voice consent, a spoken turn through the relay, transcript and metering', async ({ page }) => {
    await signInMobile(page, TESTER);
    await byId(page, 'home-assistant').click();
    await byId(page, 'assistant-talk').click();

    // Separate, explicit voice consent (the assistant consent alone is not enough).
    await expect(byId(page, 'voice-consent')).toBeVisible();
    await shot(page, 'F20-voice-consent');
    await byId(page, 'voice-consent-allow').click();
    await expect(byId(page, 'voice-start')).toBeVisible();
    await expect(byId(page, 'voice-allowance')).toContainText('voice minutes left this week');

    await byId(page, 'voice-start').click();
    await expect(page.getByText('Development simulator')).toBeVisible();
    await expect(byId(page, 'voice-remaining')).toBeVisible();
    // The synthetic speaker is heard; the simulator "transcribes" the turn and answers.
    await expect(byId(page, 'voice-line-user').first()).toContainText('[SIMULATED transcript', { timeout: 30_000 });
    await expect(byId(page, 'voice-line-assistant').first()).toContainText('[SIMULATED', { timeout: 30_000 });
    await shot(page, 'F21-voice-live');
    await byId(page, 'voice-end').click();
    await expect(byId(page, 'voice-ended-USER_ENDED')).toBeVisible();

    // Transcripts are ordinary (voice-marked) messages of the conversation; no audio is kept.
    await byId(page, 'voice-open-transcript').click();
    await expect(byId(page, 'assistant-chat')).toBeVisible();
    await expect(byId(page, 'assistant-chat').getByText('Voice', { exact: true }).first()).toBeVisible();
    await shot(page, 'F22-voice-transcript');
    const conversations = await (await tester.get('/v1/ai/conversations')).json();
    const detail = await (await tester.get(`/v1/ai/conversations/${conversations[0].id}`)).json();
    expect(detail.messages.length).toBeGreaterThanOrEqual(2);
    expect(detail.messages.every((m: { channel: string }) => m.channel === 'VOICE')).toBeTruthy();
    expect(detail.messages.some((m: { role: string; kind: string }) => m.role === 'assistant' && m.kind === 'SIMULATED')).toBeTruthy();
    // Seconds were metered against the weekly voice allowance.
    const status = await (await tester.get('/v1/ai/voice')).json();
    expect(status.allowance.used).toBeGreaterThan(0);
  });
});
