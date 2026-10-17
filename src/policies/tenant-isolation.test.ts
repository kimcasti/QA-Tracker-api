import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './tenant-access';

import { fixture, context } from '../utils/tenant-test-fixture';

test('creation does not require route params', async () => {
  const f = fixture();
  const ctx: any = context(undefined, { organization: 'A', project: 'pA' }, 'POST');
  delete ctx.params;
  assert.equal(await policy(ctx, config, f), true);
});

const config = { contentTypeUid: 'api::meeting-note.meeting-note', allowedRoles: ['owner'] };

test('owner A does not grant write permission on viewer B resource or creation', async () => {
  const f = fixture();
  await assert.rejects(policy(context('viewer'), config, f), /cannot perform this action/);
  await assert.rejects(policy(context(undefined, { organization: 'B', project: 'pB' }, 'POST'), config, f), /cannot perform this action/);
});

test('role-scoped lists include only organizations with the required role', async () => {
  const f = fixture();
  const ctx = context(undefined, {}, 'GET');
  assert.equal(await policy(ctx, config, f), true);
  assert.deepEqual(ctx.query.filters.organization.documentId.$in, ['A']);
});

test('source project restrictions cannot be bypassed by an assigned destination', async () => {
  const f = fixture();
  await assert.rejects(policy(context('restricted', { project: 'pB' }), { ...config, allowedRoles: ['viewer'] }, f), /not assigned to this project/);
});

test('unrestricted A remains usable when the user also has restricted B membership', async () => {
  const f = fixture();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal(await policy(context('own', {}, method), config, f), true);
  }
  assert.equal(await policy(context(undefined, { project: 'pA' }, 'POST'), config, f), true);
  assert.equal(await policy(context('own', { project: 'pA2' }), config, f), true);
});

test('list scope keeps unrestricted tenants and assigned projects as separate branches', async () => {
  const f = fixture();
  const ctx = context(undefined, {}, 'GET');
  assert.equal(await policy(ctx, { ...config, allowedRoles: ['owner', 'viewer'] }, f), true);
  assert.deepEqual(ctx.query.filters.$or, [
    { organization: { documentId: { $in: ['A'] } } },
    { organization: { documentId: { $in: ['B'] } }, project: { documentId: { $in: ['pB'] } } },
  ]);
});

test('organization reassignment is forbidden even with owner access to both tenants', async () => {
  const f = fixture();
  f.memberships[1].organizationRole.code = 'owner';
  await assert.rejects(policy(context('own', { organization: 'B', project: 'pB' }), config, f), /reassign/i);
});

test('payload organization cannot hide a project in another tenant', async () => {
  const f = fixture();
  await assert.rejects(policy(context(undefined, { organization: 'A', project: 'pX' }, 'POST'), config, f), /project.*organization|organization.*project/i);
  await assert.rejects(policy(context('own', { project: 'pX' }), config, f), /reassign|Cross-organization/i);
  await assert.rejects(policy(context(undefined, { organization: 'A', project: 'missing' }, 'POST'), config, f), /project.*not found/i);
});

test('relation replacement and disconnect syntax cannot bypass ownership validation', async () => {
  const f = fixture();
  for (const organization of [null, { disconnect: ['A'] }, { set: ['A', 'X'] }, { connect: [{ documentId: 'A' }, { documentId: 'X' }] }]) {
    await assert.rejects(policy(context('own', { organization }), config, f), /Invalid.*organization/i);
  }
  await assert.rejects(policy(context('own', { organization: { set: ['X'] } }), config, f), /reassign|Cross-organization/);
  assert.equal(await policy(context('own', { organization: { set: ['A'] }, project: { connect: ['pA2'] } }), config, f), true);
});

test('implicit creation chooses a role-authorized tenant rather than first membership', async () => {
  const f = fixture();
  f.memberships.reverse();
  const ctx = context(undefined, { name: 'legitimate' }, 'POST');
  assert.equal(await policy(ctx, { contentTypeUid: 'api::project.project', allowedRoles: ['owner'] }, f), true);
  assert.equal(ctx.request.body.data.organization, 'A');
});

test('missing persisted targets fail closed and cannot be supplied through the payload', async () => {
  const f = fixture();
  await assert.rejects(policy(context('missing', { organization: 'A', project: 'pA' }), config, f), /not found/i);
});

test('query predicates intersect scope and a body cannot disable list filtering', async () => {
  const f = fixture();
  const ctx = context(undefined, { organization: 'A', project: 'pA' }, 'GET');
  const filters = { organization: { documentId: 'X' }, $or: [{ title: 'x' }, { title: 'y' }] };
  ctx.query = { filters, sort: ['title:asc'], pagination: { pageSize: 10 } };
  assert.equal(await policy(ctx, { ...config, allowedRoles: ['owner', 'viewer'] }, f), true);
  assert.deepEqual(ctx.query.filters.$and[0], filters);
  assert.deepEqual(ctx.query.filters.$and[1].organization.documentId.$in, ['A', 'B']);
  assert.deepEqual(ctx.query.sort, ['title:asc']);
  assert.deepEqual(ctx.query.pagination, { pageSize: 10 });
});

test('persisted foreign origin cannot be replaced by an owned payload destination', async () => {
  const f = fixture();
  await assert.rejects(policy(context('foreign', { organization: 'A', project: 'pA' }), config, f), /Cross-organization/);
  assert.ok(f.calls.some(call => call.endsWith(':foreign')));
});
