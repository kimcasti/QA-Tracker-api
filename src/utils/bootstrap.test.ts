import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapInitialUser, bootstrapSuperAdminUser, linkMembershipForRole } from './bootstrap';

const validInitial = { INITIAL_USER_EMAIL: 'seed@example.test', INITIAL_USER_USERNAME: 'seed', INITIAL_USER_PASSWORD: 'Synthetic-Only-For-Test-42!' };
const validSuper = { SUPERADMIN_EMAIL: 'root@example.test', SUPERADMIN_USERNAME: 'root', SUPERADMIN_PASSWORD: 'Synthetic-Only-For-Test-43!' };

for (const [label, bootstrap, valid, prefix] of [
  ['initial', bootstrapInitialUser, validInitial, 'INITIAL_USER'],
  ['superadmin', bootstrapSuperAdminUser, validSuper, 'SUPERADMIN'],
] as const) {
  test(`${label} rejects partial configuration without writes`, async () => {
    await withEnv({ [`${prefix}_EMAIL`]: 'seed@example.test' }, async () => {
      const { strapi, writes } = fixture();
      await assert.rejects(bootstrap(strapi), /seed configuration/i);
      assert.equal(writes.length, 0);
    });
  });
  test(`${label} rejects password exceeding bcrypt byte limit`, async () => {
    await withEnv({ ...valid, [`${prefix}_PASSWORD`]: '界'.repeat(25) }, async () => {
      const { strapi, writes } = fixture();
      await assert.rejects(bootstrap(strapi), /seed configuration/i);
      assert.equal(writes.length, 0);
    });
  });
  test(`${label} rejects unsafe explicit password without writes`, async () => {
    await withEnv({ ...valid, [`${prefix}_PASSWORD`]: 'short' }, async () => {
      const { strapi, writes } = fixture();
      await assert.rejects(bootstrap(strapi), /seed configuration/i);
      assert.equal(writes.length, 0);
    });
  });
}

for (const [label, bootstrap, valid] of [
  ['initial', bootstrapInitialUser, validInitial], ['superadmin', bootstrapSuperAdminUser, validSuper],
] as const) {
  test(`${label} preserves existing account and privileges without updates`, async () => {
    await withEnv(valid, async () => {
      const existing = { id: 4, provider: null, isSuperAdmin: label === 'initial', blocked: true };
      const { strapi, writes } = fixture(existing);
      assert.equal(await bootstrap(strapi), existing);
      assert.equal(writes.length, 0);
    });
  });
  test(`${label} creates only with explicit complete configuration`, async () => {
    await withEnv(valid, async () => {
      const { strapi, writes } = fixture();
      const user = await bootstrap(strapi);
      assert.equal(user.id, 9);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].role, 1);
      assert.equal(writes[0].isSuperAdmin, label === 'superadmin');
    });
  });
}

test('membership rejects a nonexistent user before any membership write', async () => {
  const writes: any[] = [];
  const strapi = {
    documents: (uid: string) => ({
      findFirst: async () => uid.includes('organization-role') ? { documentId: 'role-1' } : null,
      create: async (input: any) => { writes.push(input); },
    }),
    db: { query: (uid: string) => ({
      findOne: async () => uid.includes('users-permissions') ? null : { id: 1 },
      create: async (input: any) => { writes.push(input); },
    }) },
  } as any;
  await assert.rejects(linkMembershipForRole(strapi, 'org-1', 999, 'owner'), /user.*not found/i);
  assert.equal(writes.length, 0);
});

test('absent seed configuration needs no role service and preserves production startup', async () => {
  await withEnv({}, async () => {
    assert.equal(await bootstrapInitialUser({} as any), null);
    assert.equal(await bootstrapSuperAdminUser({} as any), null);
  });
});

for (const values of [
  { INITIAL_USER_IS_SUPERADMIN: 'true' },
  { ...validInitial, INITIAL_USER_IS_SUPERADMIN: 'yes' },
  { ...validInitial, INITIAL_USER_EMAIL: 'invalid' },
  { ...validInitial, INITIAL_USER_USERNAME: '   ' },
  { INITIAL_USER_EMAIL: '' },
]) {
  test(`invalid or partial initial seed fails closed (${Object.keys(values).join(',')})`, async () => {
    await withEnv(values, async () => {
      const { strapi, writes } = fixture();
      await assert.rejects(bootstrapInitialUser(strapi), /seed configuration/i);
      assert.equal(writes.length, 0);
    });
  });
}

test('explicit superadmin privilege applies only to a newly seeded initial user', async () => {
  await withEnv({ ...validInitial, INITIAL_USER_IS_SUPERADMIN: 'true' }, async () => {
    const { strapi, writes } = fixture();
    await bootstrapInitialUser(strapi);
    assert.equal(writes[0].isSuperAdmin, true);
  });
});

test('membership rejects invalid identifiers before reading or writing', async () => {
  for (const userId of [undefined, null, 0, -1, NaN, 1.5, '9']) {
    await assert.rejects(linkMembershipForRole({} as any, 'org-1', userId as any, 'owner'), /user.*not found/i);
  }
});

test('membership with existing user preserves original linking behavior', async () => {
  const writes: any[] = [];
  const strapi = {
    documents: (uid: string) => ({ findFirst: async () => uid.includes('organization-role') ? { documentId: 'role-1' } : null }),
    db: { query: (uid: string) => ({
      findOne: async () => ({ id: uid.includes('users-permissions') ? 9 : 1 }),
      create: async (input: any) => { writes.push(input); return { id: 5 }; },
    }) },
  } as any;
  assert.deepEqual(await linkMembershipForRole(strapi, 'org-1', 9, 'owner'), { id: 5 });
  assert.deepEqual(writes, [{ data: { isActive: true, organization: 1, organizationRole: 1, user: 9 } }]);
});

const seedKeys = ['INITIAL_USER_EMAIL', 'INITIAL_USER_USERNAME', 'INITIAL_USER_PASSWORD', 'INITIAL_USER_IS_SUPERADMIN', 'SUPERADMIN_EMAIL', 'SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD'];
async function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const saved = Object.fromEntries([...seedKeys, 'NODE_ENV'].map(key => [key, process.env[key]]));
  for (const key of seedKeys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'production', ...values });
  try { await run(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
function fixture(existing: any = null) {
  const writes: any[] = [];
  const userQuery = { findOne: async () => existing, update: async (input: any) => { writes.push(input); return existing; } };
  const strapi = {
    service: () => ({ find: async () => [{ id: 1, type: 'authenticated' }] }),
    db: { query: () => userQuery },
    plugin: () => ({ service: () => ({ add: async (input: any) => { writes.push(input); return { id: 9, ...input }; } }) }),
  } as any;
  return { strapi, writes };
}

test('production without explicit seed configuration creates no initial user', async () => {
  await withEnv({}, async () => {
    const { strapi, writes } = fixture();
    assert.equal(await bootstrapInitialUser(strapi), null);
    assert.deepEqual(writes, []);
  });
});
