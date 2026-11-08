import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasController, CANVAS_UID } from './project-canvas';

const empty = () => ({ version: 1, nodes: {}, notes: [], newElementColor: 'default' });
const uids = { module: 'api::project-module.project-module', functionality: 'api::functionality.functionality', case: 'api::test-case.test-case' };

// Real controller and tenant policy: fake only document/transaction persistence boundaries.
function fixture() {
  const project = { id: 1, documentId: 'project1', organization: { id: 2, documentId: 'org1' } };
  const records = new Map<string, any>();
  for (const [kind, uid] of Object.entries(uids)) records.set(`${uid}:saved`, {
    documentId: 'saved', project: { documentId: 'project1' }, organization: { documentId: 'org1' },
  });
  let row: any = null;
  const effects: string[] = [];
  const authCalls: string[] = [];
  let afterLock = () => {};
  const strapi: any = {
    documents: (uid: string) => {
      if (uid === 'api::project.project') return { findOne: async () => project };
      if (uid === 'api::organization-membership.organization-membership') return { findMany: async () => {
        authCalls.push('membership');
        return [{ documentId: 'member1', organization: project.organization, organizationRole: { code: 'owner' } }];
      } };
      if (uid === 'api::organization-invitation.organization-invitation') return { findMany: async () => [] };
      assert.ok(Object.values(uids).includes(uid), `Unexpected documents ${uid}`);
      return { findOne: async ({ documentId }: any) => records.get(`${uid}:${documentId}`) ?? null };
    },
    db: {
      metadata: { get: () => ({ tableName: 'projects' }) },
      transaction: async (callback: any) => callback({ trx: () => ({ where: () => ({ forUpdate: () => ({ first: async () => {
        effects.push('lock'); afterLock(); return project;
      } }) }) }) }),
      query: (uid: string) => {
        if (uid === 'plugin::users-permissions.user') return { findOne: async () => ({ email: 'canvas@example.invalid' }) };
        assert.equal(uid, CANVAS_UID, 'Only Canvas metadata may be written');
        return {
          findOne: async () => row && structuredClone(row),
          create: async ({ data }: any) => { effects.push('create'); row = { ...data, id: 3, project: { id: 1 }, organization: { id: 2 } }; return row; },
          updateMany: async ({ where, data }: any) => {
            if (row.id !== where.id || row.revision !== where.revision) return { count: 0 };
            effects.push('update'); Object.assign(row, structuredClone(data)); return { count: 1 };
          },
        };
      },
    },
  };
  const ctx = (revision = 0, state: any = empty()): any => ({ state: { user: { id: 1 } }, params: { documentId: 'project1' }, request: { method: 'PUT', body: { data: { revision, state } } } });
  return { controller: createCanvasController({ strapi }), records, effects, authCalls, ctx,
    get row() { return row; }, set row(value: any) { row = value; },
    onLock(callback: () => void) { afterLock = callback; },
  };
}

function savedState() {
  return { ...empty(), nodes: { 'module:saved': { x: 1, y: 2 }, 'functionality:saved': { x: 3, y: 4 } },
    notes: [{ id: 'moduleNote', html: '<strong>Module annotation</strong>', anchorId: 'module:saved' },
      { id: 'functionNote', html: '<p>Function annotation</p>', anchorId: 'functionality:saved' },
      { id: 'caseNote', html: '<p>Case annotation</p>', anchorId: 'case:saved' }] };
}

async function savedFixture() {
  const f = fixture();
  await f.controller.update(f.ctx(0, savedState()));
  f.effects.length = 0;
  return f;
}

test('GET then entity deletion permits an independent color PUT while preserving hidden orphan bodies and anchors', async () => {
  const f = await savedFixture();
  const get = f.ctx(); await f.controller.find(get);
  f.records.clear();
  const put = f.ctx(get.body.data.revision, { ...get.body.data.state, newElementColor: 'pink' });
  await f.controller.update(put);
  assert.equal(put.body.data.revision, 2);
  assert.deepEqual(put.body.data.state.notes, savedState().notes);
  assert.deepEqual(put.body.data.state.nodes, savedState().nodes);
  assert.equal(f.row.state.newElementColor, 'pink');
  const refreshed = f.ctx(); await f.controller.find(refreshed);
  assert.deepEqual(refreshed.body.data.state, put.body.data.state);
  assert.ok(refreshed.body.data.state.notes.every((note: any) => note.anchorId));
  assert.deepEqual(f.effects, ['lock', 'update']);
  assert.ok(f.authCalls.length >= 6, 'GET and both PUT authorization checks must use the real membership policy');
});

test('deleted node positions and original note bodies remain editable only under their saved keys', async () => {
  const f = await savedFixture(); f.records.clear();
  const visual = savedState();
  visual.nodes['module:saved'] = { x: 25, y: -30 };
  visual.nodes['functionality:saved'] = { x: -10, y: 50 };
  visual.notes[2].html = '<strong>Edited annotation</strong>';
  const put = f.ctx(1, visual); await f.controller.update(put);
  assert.deepEqual(f.row.state, visual);
  assert.equal(f.row.revision, 2);
  assert.deepEqual(f.effects, ['lock', 'update']);
});

test('new missing references, new orphan notes and stolen anchors reject with zero persistence effects', async () => {
  const attacks: Array<(visual: any) => void> = [
    visual => { visual.nodes['module:newMissing'] = { x: 0, y: 0 }; },
    visual => { visual.notes.push({ id: 'newMissing', html: 'x', anchorId: 'case:newMissing' }); },
    visual => { visual.notes.push({ id: 'forged', html: 'x', anchorId: 'module:saved' }); },
    visual => { visual.notes.push({ id: 'forged', html: 'x', anchorId: 'case:saved' }); },
    visual => { visual.notes[0].anchorId = 'case:saved'; },
    visual => { visual.notes[0].id = 'replacement'; },
    visual => { visual.notes = [{ id: 'forged', html: 'x', anchorId: 'functionality:saved' }]; },
  ];
  for (const attack of attacks) {
    const f = await savedFixture(); f.records.clear();
    const before = structuredClone(f.row); const visual = savedState(); attack(visual);
    await assert.rejects(() => f.controller.update(f.ctx(1, visual)), /Canvas reference/);
    assert.deepEqual(f.row, before); assert.deepEqual(f.effects, ['lock']);
  }
  // A saved anchor does not authorize adding a new domain-node usage either.
  const f = await savedFixture(); delete f.row.state.nodes['module:saved']; f.records.clear();
  const before = structuredClone(f.row);
  await assert.rejects(() => f.controller.update(f.ctx(1, savedState())), /Canvas reference/);
  assert.deepEqual(f.row, before); assert.deepEqual(f.effects, ['lock']);
});

test('an old node alone or a formerly free note cannot authorize a new orphan anchor', async () => {
  for (const existingFreeNote of [false, true]) {
    const f = await savedFixture(); f.records.clear();
    f.row.state.notes = existingFreeNote ? [{ id: 'free', html: '<p>Keep free</p>' }] : [];
    const visual = structuredClone(f.row.state);
    if (existingFreeNote) visual.notes[0].anchorId = 'module:saved';
    else visual.notes.push({ id: 'new', html: 'x', anchorId: 'module:saved' });
    const before = structuredClone(f.row);
    await assert.rejects(() => f.controller.update(f.ctx(1, visual)), /Canvas reference/);
    assert.deepEqual(f.row, before); assert.deepEqual(f.effects, ['lock']);
  }
});

test('a new canvas cannot conserve nonexistent references', async () => {
  for (const visual of [savedState(), { ...empty(), notes: [{ id: 'new', html: 'x', anchorId: 'case:saved' }] }]) {
    const f = fixture(); f.records.clear();
    await assert.rejects(() => f.controller.update(f.ctx(0, visual)), /Canvas reference/);
    assert.equal(f.row, null); assert.deepEqual(f.effects, ['lock']);
  }
});

test('persisted references to existing foreign project or tenant records never qualify as deleted', async () => {
  for (const uid of Object.values(uids)) for (const drift of ['project', 'organization', 'documentId']) {
    const f = await savedFixture();
    const record = f.records.get(`${uid}:saved`);
    if (drift === 'documentId') record.documentId = 'different';
    else record[drift].documentId = 'foreign';
    const before = structuredClone(f.row);
    await assert.rejects(() => f.controller.update(f.ctx(1, savedState())), /Canvas reference/);
    assert.deepEqual(f.row, before); assert.deepEqual(f.effects, ['lock']);
  }
});

test('orphan conservation requires a valid allowlisted stored snapshot in the exact scope', async () => {
  const corruptions: Array<(row: any) => void> = [
    row => { row.organization.id = 99; },
    row => { row.project.id = 99; },
    row => { row.state.private = 'not allowlisted'; },
    row => { row.state.notes[0].private = 'not allowlisted'; },
    row => { row.state.nodes['module:saved'].private = 'not allowlisted'; },
    row => { row.state.notes.push({ ...row.state.notes[0] }); },
    row => { row.state.nodes = []; },
  ];
  for (const corrupt of corruptions) {
    const f = await savedFixture(); f.records.clear(); corrupt(f.row);
    const before = structuredClone(f.row);
    await assert.rejects(() => f.controller.update(f.ctx(1, savedState())), /Invalid Canvas/);
    assert.deepEqual(f.row, before); assert.deepEqual(f.effects, ['lock']);
  }
});

test('only the post-lock persisted snapshot can authorize conservation even at the same revision', async () => {
  for (const change of ['node', 'note', 'anchor']) {
    const f = await savedFixture(); f.records.clear();
    f.onLock(() => {
      if (change === 'node') delete f.row.state.nodes['module:saved'];
      else if (change === 'note') f.row.state.notes = f.row.state.notes.filter((note: any) => note.id !== 'caseNote');
      else f.row.state.notes[2].anchorId = 'module:saved';
    });
    await assert.rejects(() => f.controller.update(f.ctx(1, savedState())), /Canvas reference/);
    assert.deepEqual(f.effects, ['lock']); assert.equal(f.row.revision, 1);
  }
});

test('a post-lock revision change conflicts before stale orphan conservation can authorize writes', async () => {
  const f = await savedFixture(); f.records.clear();
  f.onLock(() => { f.row.revision = 2; f.row.state = empty(); });
  const put = f.ctx(1, savedState()); await f.controller.update(put);
  assert.equal(put.status, 409); assert.match(put.body.error.message, /Reload/);
  assert.deepEqual(f.effects, ['lock']); assert.equal(f.row.revision, 2);
  assert.deepEqual(f.row.state, empty());
});
