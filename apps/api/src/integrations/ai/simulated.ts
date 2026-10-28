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
      const tokens = (s: string) => Math.ceil([...s].length / 4);
      // Health summary: labelled points that cite the first facts it was given (no numbers of its own).
      if (req.jsonSchema?.name === 'health_summary') {
        const ids = [...last.matchAll(/^(F\d+) \[/gm)].map((m) => m[1]!).slice(0, 3);
        const ar = /in Arabic/.test(last);
        const text = JSON.stringify({
          points: ids.map((id) => ({ text: ar ? '[محاكاة — للتطوير فقط] نقطة مبنية على إحدى الحقائق التي حسبها التطبيق.' : '[SIMULATED — development only] A point based on one of the facts the app calculated.', facts: [id] })),
          questions: [ar ? '[محاكاة] ماذا أسأل الممرض عن هذه القراءات؟' : '[SIMULATED] What should I ask my nurse about these readings?'],
        });
        return { outcome: 'ANSWERED', text, servedModel: req.model, usage: { inputTokens: tokens(req.system) + tokens(last), outputTokens: tokens(text), cacheReadTokens: 0 } };
      }
      // Document reading: a fixed, labelled result — the simulator never reads the file.
      if (req.jsonSchema && req.attachments?.length) {
        const text = JSON.stringify({
          documentType: 'LAB_REPORT',
          labName: '[SIMULATED — development only, not read from your document]',
          collectedOn: null,
          results: [
            { testName: '[SIMULATED] Haemoglobin', value: '13.5', unit: 'g/dL', referenceRange: '12.0 - 16.0', flag: null },
            { testName: '[SIMULATED] White blood cells', value: '12.4', unit: 'x10^9/L', referenceRange: '4.0 - 11.0', flag: 'H' },
          ],
        });
        return { outcome: 'ANSWERED', text, servedModel: req.model, usage: { inputTokens: tokens(req.system) + 500, outputTokens: tokens(text), cacheReadTokens: 0 } };
      }
      // Cites the first reference item when one was offered, so the citation flow can be exercised.
      const cites = req.systemExtra?.includes('[K1]') ? ' Approved reference material was provided [K1].' : '';
      const text = `[SIMULATED — development only, not a real AI answer] I received ${[...last].length} characters. A real deployment answers here with general information only.${cites}`;
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
