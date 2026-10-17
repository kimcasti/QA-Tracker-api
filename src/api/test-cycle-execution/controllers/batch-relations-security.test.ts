import test from 'node:test';
import assert from 'node:assert/strict';
import cycleFactory from './test-cycle-execution';
import { fixture, context } from '../../../utils/tenant-test-fixture';

const executionUid = 'api::test-cycle-execution.test-cycle-execution';

for (const reverse of [false, true]) {
  for (const progressedId of ['target', 'duplicate']) {
    for (const clearBug of [false, true]) {
      test(`cycle batch maps original IDs to dedupe winners with partial payloads (${reverse}/${progressedId}/${clearBug})`, async () => {
        const rows = ['target', 'duplicate'].map(id => execution(id, undefined, {
          moduleName: 'same',
          ...(id === progressedId ? { executed: true, result: 'passed', evidence: 'winner evidence', bug: { documentId: 'good' } } : {}),
        }));
        const f = setupCycle('qa-engineer', reverse ? rows.reverse() : rows);
        await batch(f, [{ documentId: 'target', data: { result: 'passed', ...(clearBug ? { bug: null } : {}) } }]);
        assert.equal(f.rows().length, 1);
        assert.equal(f.rows()[0].documentId, progressedId);
        assert.equal(f.rows()[0].moduleName, 'same');
        assert.equal(f.rows()[0].executed, true);
        assert.equal(f.rows()[0].result, 'passed');
        assert.equal(f.rows()[0].evidence, 'winner evidence');
        assert.equal(f.rows()[0].bug?.documentId ?? null, clearBug ? null : 'good');
        assert.ok(!f.effects.some(effect => effect.startsWith('create:')));
      });
    }
  }
}
for (const recoveredCase of [false, true]) {
  test(`cycle create validates payload combined with projected duplicate before effects (recovered=${recoveredCase})`, async () => {
    const f = setupCycle('qa-engineer', [
      execution('target', undefined, { moduleName: 'same', functionalityName: 'second', functionality: null,
        testCaseTitle: 'good', testCase: recoveredCase ? null : { documentId: 'good' },
        executed: true, result: 'passed', evidence: 'keep evidence' }),
      ...(recoveredCase ? [execution('duplicate', undefined, { moduleName: 'same', functionalityName: 'second', testCase: { documentId: 'good' } })] : []),
    ]);
    f.relations['api::functionality.functionality'].second = {
      ...f.relations['api::functionality.functionality'].good, documentId: 'second', code: 'second',
    };
    await assert.rejects(f.controller.create(context(undefined, {
      project: 'pA', organization: 'A', testCycle: 'own', moduleName: 'same',
      functionality: 'second', testCaseTitle: 'good',
    }, 'POST')), /functionality|match/i);
    assert.deepEqual(f.effects, []);
  });
}

for (const clearCase of [false, true]) {
  test(`cycle create permits coherent projected relations and preserves progress (clear=${clearCase})`, async () => {
    const f = setupCycle('qa-engineer', [
      execution('target', undefined, { moduleName: 'same', functionalityName: 'good', testCaseTitle: 'good',
        executed: true, result: 'passed', evidence: 'keep evidence' }),
      execution('duplicate', undefined, { moduleName: 'same', functionalityName: 'good', testCase: { documentId: 'good' }, bug: { documentId: 'good' } }),
    ]);
    await f.controller.create(context(undefined, {
      project: 'pA', organization: 'A', testCycle: 'own', moduleName: 'same', functionality: 'good',
      testCaseTitle: 'good', ...(clearCase ? { testCase: null } : {}),
    }, 'POST'));
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].functionality?.documentId, 'good');
    assert.equal(f.rows()[0].testCase?.documentId ?? null, clearCase ? null : 'good');
    assert.equal(f.rows()[0].bug?.documentId, 'good');
    assert.equal(f.rows()[0].executed, true);
    assert.equal(f.rows()[0].result, 'passed');
    assert.equal(f.rows()[0].evidence, 'keep evidence');
  });
}

for (const operation of ['update', 'persist', 'batchSync'] as const) {
  for (const scenario of ['incoherent', 'coherent', 'clear'] as const) {
    test(`cycle ${operation} validates payload against relations recovered by dedupe (${scenario})`, async () => {
      const functionality = scenario === 'coherent' ? 'good' : 'second';
      const f = setupCycle('qa-engineer', [
        execution('target', undefined, { moduleName: 'same', functionalityName: functionality,
          testCaseTitle: 'good', executed: true, result: 'passed', evidence: 'keep evidence' }),
        execution('duplicate', undefined, { moduleName: 'same', functionalityName: functionality,
          testCase: { documentId: 'good' }, bug: { documentId: 'good' } }),
      ]);
      f.relations['api::functionality.functionality'].second = {
        ...f.relations['api::functionality.functionality'].good, documentId: 'second', code: 'second',
      };
      const data = { functionality, ...(scenario === 'clear' ? { testCase: null } : {}) };
      const action = operation === 'batchSync' ? batch(f, [{ documentId: 'target', data }])
        : f.controller[operation](context('target', data));
      if (scenario === 'incoherent') {
        await assert.rejects(action, /functionality|match/i);
        assert.deepEqual(f.effects, []);
      } else {
        await action;
        assert.equal(f.rows().length, 1);
        assert.equal(f.rows()[0].functionality?.documentId, functionality);
        assert.equal(f.rows()[0].testCase?.documentId ?? null, scenario === 'clear' ? null : 'good');
        assert.equal(f.rows()[0].bug?.documentId, 'good');
        assert.equal(f.rows()[0].executed, true);
        assert.equal(f.rows()[0].result, 'passed');
        assert.equal(f.rows()[0].evidence, 'keep evidence');
      }
    });
  }
}

for (const reverse of [false, true]) {
  for (const alias of ['same-id', 'duplicate-id', 'no-id'] as const) {
    test(`cycle batch rejects repeated canonical destinations before effects (${alias}/${reverse})`, async () => {
      const f = setupCycle('qa-engineer', [
        execution('target', undefined, { moduleName: 'same' }),
        execution('duplicate', undefined, { moduleName: 'same' }),
      ]);
      f.relations['api::functionality.functionality'].second = {
        ...f.relations['api::functionality.functionality'].good, documentId: 'second', code: 'second',
      };
      const items = [
        { documentId: 'target', data: { functionality: 'second' } },
        alias === 'no-id' ? { data: { moduleName: 'same' } }
          : { documentId: alias === 'same-id' ? 'target' : 'duplicate', data: { testCase: 'good' } },
      ];
      await assert.rejects(batch(f, reverse ? items.reverse() : items), {
        name: 'ValidationError', message: /ambiguous|repeated|multiple/i,
      });
      assert.deepEqual(f.effects, []);
    });
  }
}

for (const reverse of [false, true]) {
  for (const scenario of ['new-exact', 'new-name-id', 'new-relation-aliases', 'existing-lookup-alias', 'final-convergence'] as const) {
    test(`cycle batch rejects ambiguous effective identities before effects (${scenario}/${reverse})`, async () => {
      const rows = scenario === 'existing-lookup-alias' ? [execution('target')]
        : scenario === 'final-convergence' ? [execution('first'), execution('second')] : [];
      const f = setupCycle('qa-engineer', rows);
      f.relations['api::functionality.functionality'].second = {
        ...f.relations['api::functionality.functionality'].good, documentId: 'second', code: 'SECOND-CODE',
      };
      let items: any[];
      if (scenario === 'final-convergence') {
        items = ['first', 'second'].map(documentId => ({ documentId, data: { moduleName: 'same' } }));
      } else if (scenario === 'new-relation-aliases') {
        items = [
          { data: { moduleName: 'same', functionality: 'good', testCase: 'good' } },
          { data: { moduleName: ' SAME ', functionality: { connect: [{ documentId: 'good' }] }, testCase: { set: [{ documentId: 'good' }] } } },
        ];
      } else {
        const data = { moduleName: 'same', functionality: 'SECOND-CODE', testCaseTitle: 'good' };
        items = [
          { ...(scenario === 'existing-lookup-alias' ? { documentId: 'target' } : {}), data },
          { data: scenario === 'new-exact' ? { ...data }
            : { moduleName: 'same', functionalityName: 'second', testCase: 'good' } },
        ];
      }
      await assert.rejects(batch(f, reverse ? items.reverse() : items), {
        name: 'ValidationError', message: /ambiguous|repeated|multiple/i,
      });
      assert.deepEqual(f.effects, []);
    });
  }
}

test('cycle batch permits two distinct canonical destinations with partial payloads', async () => {
  const f = setupCycle('qa-engineer', [execution('first'), execution('second')]);
  await batch(f, [
    { documentId: 'first', data: { result: 'passed' } },
    { documentId: 'second', data: { result: 'failed' } },
  ]);
  assert.equal(f.rows().length, 2);
  assert.equal(f.rows().find(row => row.documentId === 'first').result, 'passed');
  assert.equal(f.rows().find(row => row.documentId === 'second').result, 'failed');
});

export function setupCycle(role = 'owner', executions: any[] = []) {
  const f = fixture();
  f.memberships[0].organizationRole.code = role;
  const effects: string[] = [];
  let rows = structuredClone(executions);
  const base = f.strapi.documents;
  const relations: Record<string, Record<string, any>> = {};
  for (const kind of ['functionality', 'test-case', 'bug']) {
    relations[`api::${kind}.${kind}`] = Object.fromEntries([
      ['good', 'A', 'pA'], ['other-project', 'A', 'pA2'], ['foreign', 'X', 'pX'], ['wrong-tenant', 'X', 'pA'],
    ].map(([id, org, project]) => [id, { documentId: id, code: id, organization: { documentId: org }, project: { documentId: project }, functionality: { documentId: 'good' } }]));
  }
  f.strapi.contentType = () => ({ kind: 'collectionType' });
  f.strapi.service = () => ({ members: async () => [{ email: 'user@example.test', fullName: 'Current Tester' }] });
  f.strapi.log = { warn() {} };
  f.strapi.documents = (uid: string) => ({
    ...base(uid),
    findOne: async (args: any) => uid === executionUid ? rows.find(row => row.documentId === args.documentId) ?? null
      : relations[uid] ? relations[uid][args.documentId] ?? null : base(uid).findOne(args),
    findFirst: async ({ filters }: any) => Object.values(relations[uid] ?? {}).find((row: any) =>
      (!filters.documentId || row.documentId === filters.documentId) && (!filters.code || row.code === filters.code)
      && (!filters.project || row.project.documentId === filters.project.documentId)
      && (!filters.organization || row.organization.documentId === filters.organization.documentId)) ?? null,
    findMany: async (args: any) => uid === executionUid ? structuredClone(rows) : base(uid).findMany(args),
    update: async ({ documentId, data }: any) => {
      effects.push(`update:${uid}:${documentId}`);
      if (uid !== executionUid) return { documentId, ...data };
      const row = { ...rows.find(row => row.documentId === documentId), ...data, documentId };
      for (const key of ['organization', 'project', 'testCycle', 'functionality', 'testCase', 'bug']) {
        if (typeof row[key] === 'string') row[key] = { documentId: row[key] };
      }
      rows = rows.map(item => item.documentId === documentId ? row : item);
      return structuredClone(row);
    },
    create: async ({ data }: any) => {
      const row: any = { ...data, documentId: `created-${rows.length}` };
      for (const key of ['organization', 'project', 'testCycle', 'functionality', 'testCase', 'bug']) {
        if (typeof row[key] === 'string') row[key] = { documentId: row[key] };
      }
      effects.push(`create:${uid}`); rows.push(row); return structuredClone(row);
    },
    delete: async ({ documentId }: any) => { effects.push(`delete:${uid}:${documentId}`); rows = rows.filter(row => row.documentId !== documentId); return {}; },
  });
  (globalThis as any).strapi = f.strapi;
  return { ...f, effects, relations, rows: () => rows, controller: cycleFactory({ strapi: f.strapi }) };
}

export function execution(documentId: string, assignedTesterEmail = 'user@example.test', extra: any = {}) {
  return { documentId, moduleName: documentId, assignedTesterEmail, organization: { documentId: 'A' }, project: { documentId: 'pA' }, testCycle: { documentId: 'own' }, ...extra };
}
export async function batch(f: ReturnType<typeof setupCycle>, items: any[]) {
  const ctx: any = context(undefined, { testCycle: 'own', items }, 'POST');
  await f.controller.batchSync(ctx); return ctx;
}

for (const key of ['functionality', 'testCase', 'bug'] as const) {
  for (const value of ['foreign', 'other-project', 'wrong-tenant', 'missing', { connect: [{ documentId: 'good' }, { documentId: 'foreign' }] }]) {
    test(`cycle batch prevalidates every ${key}: ${JSON.stringify(value)} before dedupe or earlier item writes`, async () => {
      const f = setupCycle('owner', [execution('old', undefined, { moduleName: 'same' }), execution('duplicate', undefined, { moduleName: 'same' })]);
      await assert.rejects(batch(f, [{ data: { moduleName: 'valid-first' } }, { data: { [key]: value } }]), /Invalid|match|not found/i);
      assert.deepEqual(f.effects, []);
    });
  }
}
for (const [key, value] of [['organization', 'B'], ['project', 'pA2'], ['testCycle', 'foreign']] as const) {
  test(`cycle batch rejects item ${key} that disagrees with persisted parent`, async () => {
    const f = setupCycle();
    await assert.rejects(batch(f, [{ data: {} }, { data: { [key]: value } }]), /Invalid|match/i);
    assert.deepEqual(f.effects, []);
  });
}
test('cycle batch rejects a test case belonging to another functionality before writes', async () => {
  const f = setupCycle();
  f.relations['api::functionality.functionality'].second = { ...f.relations['api::functionality.functionality'].good, documentId: 'second' };
  await assert.rejects(batch(f, [{ data: { functionality: 'second', testCase: 'good' } }]), /functionality|match/i);
  assert.deepEqual(f.effects, []);
});
for (const documentId of ['foreign-execution', 'missing-execution']) {
  test(`cycle batch rejects unknown execution ${documentId} before earlier item writes`, async () => {
    const f = setupCycle('owner', [execution('mine')]);
    await assert.rejects(batch(f, [{ data: { moduleName: 'valid-first' } }, { documentId, data: { moduleName: 'mine' } }]), /Invalid|not found/i);
    assert.deepEqual(f.effects, []);
  });
}
test('cycle batch validates test case coherence with functionality retained from persisted execution', async () => {
  const f = setupCycle('owner', [execution('mine', undefined, { functionality: { documentId: 'second' } })]);
  f.relations['api::functionality.functionality'].second = { ...f.relations['api::functionality.functionality'].good, documentId: 'second' };
  await assert.rejects(batch(f, [{ documentId: 'mine', data: { testCase: 'good' } }]), /functionality|match/i);
  assert.deepEqual(f.effects, []);
});
test('cycle batch retains and validates omitted relations on updates', async () => {
  const f = setupCycle('qa-engineer', [execution('mine', undefined, { functionality: { documentId: 'good' }, testCase: { documentId: 'good' }, bug: { documentId: 'good' } })]);
  await batch(f, [{ documentId: 'mine', data: { result: 'passed' } }]);
  assert.equal(f.rows()[0].functionality.documentId, 'good');
  assert.equal(f.rows()[0].testCase.documentId, 'good');
  assert.equal(f.rows()[0].bug.documentId, 'good');
});
test('cycle persist preauthorizes collisions introduced by changing the target identity', async () => {
  const f = setupCycle('qa-engineer', [execution('mine'), execution('peer', 'other@example.test'), execution('duplicate-a', undefined, { moduleName: 'same' }), execution('duplicate-b', undefined, { moduleName: 'same' })]);
  const ctx: any = context('mine', { moduleName: 'peer' });
  await assert.rejects(f.controller.persist(ctx), /assigned to another tester/);
  assert.deepEqual(f.effects, []);
});

for (const scenario of ['omitted', 'later-item', 'duplicate'] as const) {
  test(`cycle qa-engineer rejects ${scenario} assigned to another tester with zero effects`, async () => {
    const own = execution('mine', 'user@example.test', { moduleName: scenario === 'duplicate' ? 'same' : 'mine' });
    const other = execution('other', 'other@example.test', { moduleName: scenario === 'duplicate' ? 'same' : 'other' });
    const f = setupCycle('qa-engineer', [own, other]);
    const items = scenario === 'omitted' ? [] : [{ documentId: 'mine', data: { moduleName: own.moduleName } }, ...(scenario === 'later-item' ? [{ documentId: 'other', data: { assignedTesterEmail: 'user@example.test' } }] : [])];
    await assert.rejects(batch(f, items), /assigned to another tester/);
    assert.deepEqual(f.effects, []);
  });
}
for (const operation of ['create', 'update', 'persist'] as const) {
  for (const targetOwner of ['user@example.test', 'other@example.test']) {
    test(`cycle ${operation} preauthorizes all dedupe candidates (target ${targetOwner})`, async () => {
      const f = setupCycle('qa-engineer', [execution('target', targetOwner, { moduleName: 'same' }), execution('duplicate', 'other@example.test', { moduleName: 'same' })]);
      const ctx: any = context(operation === 'create' ? undefined : 'target', { project: 'pA', organization: 'A', testCycle: 'own', moduleName: 'same' }, operation === 'create' ? 'POST' : 'PUT');
      await assert.rejects(f.controller[operation](ctx), /assigned to another tester/);
      assert.deepEqual(f.effects, []);
    });
  }
}
for (const role of ['owner', 'qa-lead', 'qa-engineer']) {
  test(`cycle ${role} retains authorized batch updates, dedupe and omitted deletion`, async () => {
    const owner = role === 'qa-engineer' ? 'user@example.test' : 'other@example.test';
    const f = setupCycle(role, [execution('target', owner, { moduleName: 'same' }), execution('duplicate', owner, { moduleName: 'same' }), execution('omitted', owner)]);
    await batch(f, [{ documentId: 'target', data: { moduleName: 'same', result: 'passed', executed: true } }]);
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].result, 'passed');
    assert.ok(f.effects.some(effect => effect.startsWith('delete:')));
  });
}
test('cycle update retains progress merged from an authorized duplicate', async () => {
  const f = setupCycle('qa-engineer', [execution('mine', undefined, { moduleName: 'same' }), execution('duplicate', undefined, { moduleName: 'same', executed: true, result: 'passed', evidence: 'keep evidence' })]);
  const ctx: any = context('mine', { moduleName: 'same' });
  await f.controller.update(ctx);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].executed, true);
  assert.equal(f.rows()[0].result, 'passed');
  assert.equal(f.rows()[0].evidence, 'keep evidence');
});
for (const assignment of [{ assignedTesterEmail: null, assignedTesterName: 'Current Tester' }, { assignedTesterEmail: null, assignedTesterName: null }]) {
  test(`cycle qa-engineer preserves directory-name and unassigned access ${JSON.stringify(assignment)}`, async () => {
    const f = setupCycle('qa-engineer', [execution('mine', undefined, assignment)]);
    await batch(f, [{ documentId: 'mine', data: { executed: true, result: 'passed' } }]);
    assert.equal(f.rows()[0].result, 'passed');
  });
}

for (const operation of ['update', 'persist'] as const) {
  test(`cycle qa-engineer ${operation} keeps own target available with unrelated peer execution`, async () => {
    const f = setupCycle('qa-engineer', [execution('mine'), execution('peer', 'other@example.test')]);
    const ctx: any = context('mine', { result: 'passed', executed: true });
    await f.controller[operation](ctx);
    assert.equal(f.rows().find(row => row.documentId === 'mine').result, 'passed');
    assert.equal(f.rows().find(row => row.documentId === 'peer').assignedTesterEmail, 'other@example.test');
  });
}

test('cycle batch keeps valid scoped relations, code aliases and explicit clearing available', async () => {
  const f = setupCycle();
  f.relations['api::functionality.functionality'].good.code = 'FEATURE-CODE';
  await batch(f, [{ data: { moduleName: 'linked', functionality: 'FEATURE-CODE', testCase: 'good', bug: 'good' } }, { data: { moduleName: 'clear', functionality: null, testCase: null, bug: null } }]);
  assert.equal(f.rows().length, 2);
  assert.equal(f.rows()[0].functionality.documentId, 'good');
  assert.equal(f.rows()[0].testCase.documentId, 'good');
  assert.equal(f.rows()[0].bug.documentId, 'good');
});

test('cycle create preserves progress merged into its duplicate before applying a partial payload', async () => {
  const f = setupCycle('qa-engineer', [
    execution('target', undefined, { moduleName: 'same' }),
    execution('duplicate', undefined, { moduleName: 'same', executed: true, result: 'passed', evidence: 'merged evidence' }),
  ]);
  const ctx: any = context(undefined, { project: 'pA', organization: 'A', testCycle: 'own', moduleName: 'same' }, 'POST');
  await f.controller.create(ctx);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].executed, true);
  assert.equal(f.rows()[0].result, 'passed');
  assert.equal(f.rows()[0].evidence, 'merged evidence');
});

for (const clearBug of [false, true]) {
  test(`cycle batch preserves dedupe bug links unless explicitly cleared (${clearBug})`, async () => {
    const f = setupCycle('qa-engineer', [
      execution('target', undefined, { moduleName: 'same', executed: true, result: 'passed', evidence: 'target progress', bug: null }),
      execution('duplicate', undefined, { moduleName: 'same', bug: { documentId: 'good' } }),
    ]);
    await batch(f, [{ documentId: 'target', data: { moduleName: 'same', ...(clearBug ? { bug: null } : {}) } }]);
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].bug?.documentId ?? null, clearBug ? null : 'good');
    assert.equal(f.rows()[0].evidence, 'target progress');
  });
}

for (const operation of ['create', 'update', 'persist'] as const) {
  for (const key of ['functionality', 'testCase', 'bug'] as const) {
    for (const value of ['foreign', 'other-project', 'wrong-tenant', 'missing', { connect: [{ documentId: 'good' }, { documentId: 'foreign' }] }]) {
      test(`cycle ${operation} rejects scoped ${key}=${value} before dedupe and persistence`, async () => {
        const f = setupCycle('qa-engineer', [
          execution('target', undefined, { moduleName: 'same' }),
          execution('duplicate', undefined, { moduleName: 'same' }),
        ]);
        const ctx: any = context(operation === 'create' ? undefined : 'target',
          { organization: 'A', project: 'pA', testCycle: 'own', moduleName: 'same', [key]: value },
          operation === 'create' ? 'POST' : 'PUT');
        await assert.rejects(f.controller[operation](ctx), /Invalid|not found|match/i);
        assert.deepEqual(f.effects, []);
      });
    }
  }
  test(`cycle ${operation} accepts scoped normalized relation forms`, async () => {
    const f = setupCycle('qa-engineer', operation === 'create' ? [] : [execution('target')]);
    f.relations['api::functionality.functionality'].good.code = 'CODE-OWN';
    const ctx: any = context(operation === 'create' ? undefined : 'target', {
      project: 'pA', organization: 'A', testCycle: 'own', moduleName: 'same',
      functionality: 'CODE-OWN', testCase: { set: [{ documentId: 'good' }] },
      bug: { connect: [{ documentId: 'good' }] },
    }, operation === 'create' ? 'POST' : 'PUT');
    await f.controller[operation](ctx);
    for (const key of ['functionality', 'testCase', 'bug']) assert.equal(f.rows()[0][key].documentId, 'good');
  });
  if (operation !== 'create') {
    test(`cycle ${operation} honors explicit clearing of all relations`, async () => {
      const f = setupCycle('qa-engineer', [execution('target', undefined, {
        functionality: { documentId: 'good' }, testCase: { documentId: 'good' }, bug: { documentId: 'good' },
      })]);
      await f.controller[operation](context('target', { functionality: null, testCase: null, bug: null }));
      for (const key of ['functionality', 'testCase', 'bug']) assert.equal(f.rows()[0][key], null);
    });
  }
}

for (const operation of ['create', 'update'] as const) {
  test(`cycle ${operation} retains functionality recovered from an authorized duplicate`, async () => {
    const f = setupCycle('qa-engineer', [
      execution('target', undefined, { moduleName: 'same', functionalityName: 'good', executed: true, result: 'passed', evidence: 'keep' }),
      execution('duplicate', undefined, { moduleName: 'same', functionalityName: 'good', functionality: { documentId: 'good' } }),
    ]);
    await f.controller[operation](context(operation === 'create' ? undefined : 'target', {
      organization: 'A', project: 'pA', testCycle: 'own', moduleName: 'same', functionalityName: 'good',
    }, operation === 'create' ? 'POST' : 'PUT'));
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].functionality?.documentId, 'good');
    assert.equal(f.rows()[0].evidence, 'keep');
  });
}

for (const operation of ['create', 'update', 'persist', 'batchSync'] as const) {
  test(`cycle ${operation} rejects a foreign bug inherited from another duplicate before any effect`, async () => {
    const f = setupCycle('qa-engineer', [
      execution('target', undefined, { moduleName: 'same' }),
      execution('duplicate', undefined, { moduleName: 'same', bug: { documentId: 'foreign' } }),
    ]);
    const data = { organization: 'A', project: 'pA', testCycle: 'own', moduleName: 'same' };
    const action = operation === 'batchSync'
      ? batch(f, [{ documentId: 'target', data }])
      : f.controller[operation](context(operation === 'create' ? undefined : 'target', data,
        operation === 'create' ? 'POST' : 'PUT'));
    await assert.rejects(action, /Invalid|not found|match/i);
    assert.deepEqual(f.effects, []);
  });
  test(`cycle ${operation} checks the coherence of relations combined by dedupe`, async () => {
    const f = setupCycle('qa-engineer', [
      execution('target', undefined, { moduleName: 'same', functionality: { documentId: 'second' }, testCaseTitle: 'good' }),
      execution('duplicate', undefined, { moduleName: 'same', functionalityName: 'second', testCase: { documentId: 'good' } }),
    ]);
    f.relations['api::functionality.functionality'].second = {
      ...f.relations['api::functionality.functionality'].good, documentId: 'second', code: 'second',
    };
    const data = { project: 'pA', organization: 'A', testCycle: 'own', moduleName: 'same', functionalityName: 'second', testCaseTitle: 'good' };
    const action = operation === 'batchSync' ? batch(f, [{ documentId: 'target', data }])
      : f.controller[operation](context(operation === 'create' ? undefined : 'target', data,
        operation === 'create' ? 'POST' : 'PUT'));
    await assert.rejects(action, /Invalid|functionality|match/i);
    assert.deepEqual(f.effects, []);
  });
}

for (const operation of ['create', 'update', 'persist'] as const) {
  test(`cycle ${operation} rejects a project differing from its persisted parent`, async () => {
    const f = setupCycle('qa-engineer', [execution('target')]);
    await assert.rejects(f.controller[operation](context(operation === 'create' ? undefined : 'target', {
      project: 'pA2', organization: 'A', testCycle: 'own',
    }, operation === 'create' ? 'POST' : 'PUT')), /Invalid|match/i);
    assert.deepEqual(f.effects, []);
  });
}
