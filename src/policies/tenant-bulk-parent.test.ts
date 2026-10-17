import assert from 'node:assert/strict';
import test from 'node:test';
import policy from './tenant-access';
import runRoutes from '../api/test-run-result/routes/batch-sync';
import cycleRoutes from '../api/test-cycle-execution/routes/batch-sync';
import { fixture, context } from '../utils/tenant-test-fixture';

for (const [parentKey, routes] of [['testRun', runRoutes], ['testCycle', cycleRoutes]] as const) {
  const config = routes.routes[0].config.policies[0].config;
  test(`${parentKey} bulk derives implicit scope from its persisted parent in the second tenant`, async () => {
    const f = fixture();
    f.memberships[1].organizationRole.code = 'owner';
    const ctx = context(undefined, { [parentKey]: 'viewer', items: [] }, 'POST');
    assert.equal(await policy(ctx, config, f), true);
    assert.equal(ctx.request.body.data.organization, 'B');
    assert.equal(ctx.request.body.data.project, 'pB');
  });
  test(`${parentKey} bulk cannot substitute a different authorized project for its parent`, async () => {
    const f = fixture();
    const ctx = context(undefined, { [parentKey]: 'own', organization: 'A', project: 'pA2', items: [] }, 'POST');
    await assert.rejects(policy(ctx, config, f), /match.*parent|parent.*match/i);
  });
  test(`${parentKey} route rejects foreign and lower-role parents even with an owned payload`, async () => {
    const f = fixture();
    await assert.rejects(policy(context(undefined, { [parentKey]: 'foreign', organization: 'A', project: 'pA', items: [] }, 'POST'), config, f), /Cross-organization/);
    await assert.rejects(policy(context(undefined, { [parentKey]: 'viewer', organization: 'A', project: 'pA', items: [] }, 'POST'), config, f), /cannot perform/);
    await assert.rejects(policy(context(undefined, { [parentKey]: null, items: [] }, 'POST'), config, f), /Invalid parent/);
  });
}
