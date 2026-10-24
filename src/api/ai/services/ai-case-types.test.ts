import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import createAiService from './ai';

function setupGeneration(t: TestContext, provider: 'gemini' | 'groq') {
  const runtime = globalThis as unknown as { strapi: unknown };
  const previousStrapi = runtime.strapi;
  const envKeys = ['GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'GROQ_API_KEY', 'VITE_GROQ_API_KEY'];
  const previousEnv = envKeys.map(key => process.env[key]);
  envKeys.forEach(key => { delete process.env[key]; });
  process.env[provider === 'gemini' ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'] = 'synthetic-test-key';
  t.after(() => {
    runtime.strapi = previousStrapi;
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  });
  let charges = 0;
  runtime.strapi = {
    service: (name: string) => {
      assert.equal(name, 'api::plan-access.plan-access');
      return {
        authorizeAi: async (userId: number, projectId: string) => {
          assert.equal(userId, 7);
          assert.equal(projectId, 'synthetic-project');
        },
        consumeAiUsage: async () => { charges += 1; },
      };
    },
  };
  let responseValue: unknown;
  const prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const isGemini = String(url).startsWith('https://generativelanguage.googleapis.com/');
    assert.equal(isGemini, provider === 'gemini');
    prompts.push(isGemini ? body.contents[0].parts[0].text : body.messages[1].content);
    const text = JSON.stringify(responseValue);
    return new Response(JSON.stringify(isGemini
      ? { candidates: [{ content: { parts: [{ text }] } }] }
      : { choices: [{ message: { content: text } }] }), { status: 200 });
  });
  const service = createAiService();
  return {
    prompts,
    get charges() { return charges; },
    generate: async (value: unknown) => {
      responseValue = value;
      return service.generateTestCases(7, {
        projectId: 'synthetic-project', functionalityName: 'Synthetic login', moduleName: 'Synthetic access',
      });
    },
  };
}

for (const provider of ['gemini', 'groq'] as const) {
  test(`${provider} generation prompt permits only Funcional and UAT`, async t => {
    const harness = setupGeneration(t, provider);
    await harness.generate({ title: 'Synthetic case', testType: 'Funcional' });
    assert.equal(harness.prompts.length, 1);
    assert.match(harness.prompts[0], /Usa testType solo de esta lista: Funcional, UAT\./);
    assert.doesNotMatch(harness.prompts[0], /Integración|Sanity|Regresión|Smoke|Exploratoria/);
  });

  test(`${provider} new case generation preserves UAT and maps every other type to Funcional`, async t => {
    const harness = setupGeneration(t, provider);
    const types: unknown[] = ['UAT', 'Funcional', 'Integración', 'Sanity', 'Regresión', 'Smoke', 'Exploratoria',
      'arbitrary-provider-type', 'uat', '', null, undefined, 42, { invalid: true }];
    for (const testType of types) {
      await t.test(`provider testType ${JSON.stringify(testType)}`, async () => {
        const fixture = {
          title: 'Synthetic case', description: 'Synthetic description', preconditions: ['Ready'],
          testSteps: ['Open form', 'Submit'], expectedResult: 'Success', priority: 'Alto', testType,
        };
        const result = await harness.generate(fixture);
        assert.deepEqual(result, [{
          title: fixture.title, description: fixture.description, preconditions: 'Ready',
          testSteps: '1. Open form\n2. Submit', expectedResult: 'Success', priority: 'Alto',
          testType: testType === 'UAT' ? 'UAT' : 'Funcional',
        }]);
        assert.equal(fixture.testType, testType, 'provider fixture is not mutated');
      });
    }
    assert.equal(harness.charges, types.length);
  });
}
