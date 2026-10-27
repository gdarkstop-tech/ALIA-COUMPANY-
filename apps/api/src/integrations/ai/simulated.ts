import type { AiProvider } from './types';

/**
 * Development / automated-test stand-in. Refused by the gateway in production; every answer is
 * labelled as simulated and contains no health information of its own.
 */
export function createSimulatedProvider(): AiProvider {
  return {
    code: 'SIMULATED',
    status: 'CONFIGURED',
    async complete(req) {
      const last = req.messages[req.messages.length - 1]?.content ?? '';
      // Cites the first reference item when one was offered, so the citation flow can be exercised.
      const cites = req.systemExtra?.includes('[K1]') ? ' Approved reference material was provided [K1].' : '';
      const text = `[SIMULATED — development only, not a real AI answer] I received ${[...last].length} characters. A real deployment answers here with general information only.${cites}`;
      const tokens = (s: string) => Math.ceil([...s].length / 4);
      return {
        outcome: 'ANSWERED',
        text,
        servedModel: req.model,
        usage: { inputTokens: tokens(req.system) + req.messages.reduce((n, m) => n + tokens(m.content), 0), outputTokens: tokens(text), cacheReadTokens: 0 },
      };
    },
    async healthCheck() {
      return { ok: true, detail: 'simulated', checkedAt: new Date().toISOString() };
    },
  };
}
