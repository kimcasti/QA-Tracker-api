import assert from 'node:assert/strict';
import test from 'node:test';
import policy from './tenant-access';
import { fixture, context } from '../utils/tenant-test-fixture';

const config = { contentTypeUid: 'api::external-participant.external-participant', allowedRoles: ['owner', 'viewer'] };

test('restricted participant lists scope sourceProject and retain organization-wide contacts', async () => {
  const f = fixture();
  f.memberships.splice(0, 1);
  const ctx = context(undefined, {}, 'GET');
  assert.equal(await policy(ctx, config, f), true);
  assert.deepEqual(ctx.query.filters, {
    organization: { documentId: { $in: ['B'] } },
    $or: [
      { sourceProject: { documentId: { $in: ['pB'] } } },
      { sourceProject: { id: { $null: true } } },
    ],
  });
});

test('participant reads resolve the persisted sourceProject before authorizing access', async () => {
  const f = fixture();
  f.entities.viewer.sourceProject = f.entities.viewer.project;
  delete f.entities.viewer.project;
  assert.equal(await policy(context('viewer', {}, 'GET'), config, f), true);
  f.entities.restricted.sourceProject = f.entities.restricted.project;
  delete f.entities.restricted.project;
  await assert.rejects(policy(context('restricted', {}, 'GET'), config, f), /not assigned/);
});

test('restricted readers can use organization-wide participants without weakening other resource scopes', async () => {
  const f = fixture();
  f.entities.contact = { documentId: 'contact', organization: { documentId: 'B' }, sourceProject: null };
  assert.equal(await policy(context('contact', {}, 'GET'), config, f), true);
  await assert.rejects(policy(context('contact', {}, 'GET'), {
    contentTypeUid: 'api::meeting-note.meeting-note', allowedRoles: ['viewer'],
  }, f), /not assigned/);
});

test('participant sourceProject payload cannot smuggle a foreign or unassigned project', async () => {
  const f = fixture();
  await assert.rejects(policy(context(undefined, { organization: 'A', sourceProject: 'pX' }, 'POST'), config, f), /Project and organization do not match/);
  await assert.rejects(policy(context(undefined, { organization: 'B', sourceProject: 'pB2' }, 'POST'), config, f), /not assigned/);
  assert.equal(await policy(context(undefined, { organization: 'A', sourceProject: 'pA' }, 'POST'), config, f), true);
});

test('mixed participant list scopes intersect user OR filters without exposing other projects', async () => {
  const f = fixture();
  const ctx = context(undefined, {}, 'GET');
  const filters = { $or: [{ name: { $containsi: 'qa' } }, { email: { $containsi: 'example' } }] };
  ctx.query = { filters };
  assert.equal(await policy(ctx, config, f), true);
  assert.deepEqual(ctx.query.filters.$and[0], filters);
  assert.deepEqual(ctx.query.filters.$and[1], {
    organization: { documentId: { $in: ['A', 'B'] } },
    $or: [
      { organization: { documentId: { $in: ['A'] } } },
      { organization: { documentId: { $in: ['B'] } }, $or: [
        { sourceProject: { documentId: { $in: ['pB'] } } },
        { sourceProject: { id: { $null: true } } },
      ] },
    ],
  });
});

test('participant detail and updates reject foreign origin and unassigned destinations', async () => {
  const f = fixture();
  f.entities.viewer.sourceProject = f.entities.viewer.project;
  delete f.entities.viewer.project;
  await assert.rejects(policy(context('foreign', {}, 'GET'), config, f), /Cross-organization/);
  await assert.rejects(policy(context('viewer', { sourceProject: 'pB2' }), config, f), /not assigned/);
});
