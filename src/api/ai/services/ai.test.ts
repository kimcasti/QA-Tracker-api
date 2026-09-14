import assert from 'node:assert/strict';
import { test } from 'node:test';
import createAiService from './ai';

test('evidence interpretation enforces authorization, normalizes output and charges only successful requests', async t => {
  const runtime = globalThis as unknown as { strapi: unknown };
  const previousStrapi = runtime.strapi;
  const envKeys = ['GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'GROQ_API_KEY', 'VITE_GROQ_API_KEY', 'GROQ_MODEL'];
  const previousEnv = envKeys.map(key => process.env[key]);
  envKeys.forEach(key => { delete process.env[key]; });
  process.env.GROQ_API_KEY = 'test-key';
  t.after(() => {
    runtime.strapi = previousStrapi;
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  });
  let authorized = true;
  let charges = 0;
  runtime.strapi = {
    service: (name: string) => {
      assert.equal(name, 'api::plan-access.plan-access');
      return {
        authorizeAi: async (userId: number, projectId: string) => {
          assert.equal(userId, 7);
          assert.equal(projectId, 'project-one');
          if (!authorized) throw new Error('Forbidden');
        },
        consumeAiUsage: async () => { charges += 1; },
      };
    },
  };
  let paragraph: unknown = 'Permaneció en **Login**.\n\nFalló tras 5 segundos. Se adjunta evidencia.';
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ paragraph }) } }],
  }), { status: 200 }));
  const service = createAiService();
  const input = { projectId: 'project-one', notes: 'Expected /patients; received /login; Timeout: 5000ms', context: 'Inicio de sesión', hasEvidence: false };
  const result = await service.interpretExecutionEvidence(7, input);
  assert.equal(result?.paragraph, 'Permaneció en **Login**. Falló tras 5 segundos.');
  assert.equal(charges, 1);
  const requestedModel = () => JSON.parse(
    (fetchMock.mock.calls.at(-1)!.arguments as unknown as [string, RequestInit])[1].body as string,
  ).model;
  assert.equal(requestedModel(), 'openai/gpt-oss-20b');
  process.env.GROQ_MODEL = ' openai/gpt-oss-120b ';
  const withEvidence = await service.interpretExecutionEvidence(7, { ...input, hasEvidence: true });
  assert.equal(requestedModel(), 'openai/gpt-oss-120b');
  assert.equal(withEvidence?.paragraph, 'Permaneció en **Login**. Falló tras 5 segundos. Se adjunta evidencia.');
  assert.equal(charges, 2);
  paragraph = '';
  await assert.rejects(service.interpretExecutionEvidence(7, input));
  assert.equal(charges, 2);
  const calls = fetchMock.mock.callCount();
  authorized = false;
  await assert.rejects(service.interpretExecutionEvidence(7, input), /Forbidden/);
  assert.equal(fetchMock.mock.callCount(), calls);
  assert.equal(charges, 2);
});
