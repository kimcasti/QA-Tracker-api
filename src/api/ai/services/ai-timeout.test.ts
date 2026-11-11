import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import createAiService from './ai';

function fixture(t: TestContext) {
  const runtime = globalThis as unknown as { strapi: unknown };
  const previous = runtime.strapi;
  const keys = ['GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'GROQ_API_KEY', 'VITE_GROQ_API_KEY'];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { delete process.env[key]; });
  process.env.GEMINI_API_KEY = 'synthetic-gemini';
  process.env.GROQ_API_KEY = 'synthetic-groq';
  let charges = 0;
  runtime.strapi = {
    log: { warn() {} },
    service: () => ({ authorizeAi: async () => {}, consumeAiUsage: async () => { charges++; } }),
  };
  t.after(() => {
    runtime.strapi = previous;
    keys.forEach((key, i) => {
      if (env[i] === undefined) delete process.env[key];
      else process.env[key] = env[i];
    });
  });
  return {
    run: () => createAiService().interpretExecutionEvidence(7, {
      projectId: 'synthetic-project', notes: 'Synthetic failure', context: 'Synthetic flow', hasEvidence: false,
    }),
    charges: () => charges,
  };
}

test('provider deadline allows more than 15 seconds and aborts at 60 seconds', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let geminiSignal: AbortSignal | undefined;
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    attempts++;
    if (attempts > 1) return groqResponse();
    geminiSignal = init.signal!;
    return new Promise<Response>((_resolve, reject) => {
      geminiSignal!.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')), { once: true });
    });
  });
  const result = f.run();
  void result.catch(() => {});
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(geminiSignal);
  t.mock.timers.tick(15_000);
  assert.equal(geminiSignal.aborted, false);
  t.mock.timers.tick(44_999);
  assert.equal(geminiSignal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(geminiSignal.aborted, true);
  assert.equal((await result)?.paragraph, 'Resultado sintético de respaldo.');
  assert.equal(attempts, 2);
  assert.equal(f.charges(), 1);
});

const groqResponse = () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ paragraph: 'Resultado sintético de respaldo.' }) } }],
}));

test('two timed-out providers stop without retrying or charging usage', async t => {
  const f = fixture(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('Synthetic timeout', 'AbortError');
  });
  await assert.rejects(f.run(), /AI_PROVIDER_TIMEOUT/);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(f.charges(), 0);
});

test('timeout without configured Groq preserves the error and does not charge', async t => {
  const f = fixture(t);
  delete process.env.GROQ_API_KEY;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('Synthetic timeout', 'AbortError');
  });
  await assert.rejects(f.run(), /AI_PROVIDER_TIMEOUT/);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(f.charges(), 0);
});

test('Gemini timeout falls back to Groq exactly once and charges only the successful action', async t => {
  const f = fixture(t);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const host = new URL(url).hostname;
    calls.push(host);
    if (host === 'generativelanguage.googleapis.com') throw new DOMException('Synthetic timeout', 'AbortError');
    return groqResponse();
  });
  assert.equal((await f.run())?.paragraph, 'Resultado sintético de respaldo.');
  assert.deepEqual(calls, ['generativelanguage.googleapis.com', 'api.groq.com']);
  assert.equal(f.charges(), 1);
});
