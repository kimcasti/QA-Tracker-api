import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../index';

const keys = ['INITIAL_USER_EMAIL', 'INITIAL_USER_USERNAME', 'INITIAL_USER_PASSWORD', 'INITIAL_USER_IS_SUPERADMIN', 'SUPERADMIN_EMAIL', 'SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD'];
function fixture() {
  const calls: string[] = [];
  const strapi = {
    store: () => ({ get: async () => { calls.push('settings'); return { allow_register: false }; } }),
    service: () => ({ find: async () => [] }),
    log: { warn: () => undefined },
    db: { query: () => ({ findMany: async () => [] }) },
    documents: () => { calls.push('seed documents'); throw new Error('Unexpected seed document access'); },
  } as any;
  return { calls, strapi };
}
async function isolated(values: Record<string, string>, run: () => Promise<void>) {
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try { await run(); } finally {
    app.destroy();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
test('startup without seed configuration does not create seed organization or membership', async () => {
  await isolated({}, async () => {
    const { calls, strapi } = fixture();
    await app.bootstrap({ strapi });
    assert.deepEqual(calls, ['settings']);
  });
});
test('startup rejects partial superadmin seed before any bootstrap writes', async () => {
  await isolated({ SUPERADMIN_EMAIL: 'root@example.test' }, async () => {
    const { calls, strapi } = fixture();
    await assert.rejects(app.bootstrap({ strapi }), /seed configuration/i);
    assert.deepEqual(calls, []);
  });
});
