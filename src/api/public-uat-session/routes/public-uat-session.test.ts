import test from 'node:test';
import assert from 'node:assert/strict';
import router from './public-uat-session';
import publicActions from './public-actions';
import { EXPOSED_ACTIONS } from '../../../utils/access';

test('actual UAT core router exposes reads only, never generic session writes', () => {
  const previous = (globalThis as any).strapi;
  const model = { uid: 'api::public-uat-session.public-uat-session', kind: 'collectionType',
    info: { singularName: 'public-uat-session', pluralName: 'public-uat-sessions' }, attributes: {} };
  (globalThis as any).strapi = {
    contentType: () => model, getModel: () => model,
    plugin: () => ({ service: () => ({ isLocalizedContentType: () => false }) }),
  };
  try {
    const routes = router.routes;
    assert.deepEqual(routes.map((route: any) => route.method), ['GET', 'GET']);
    assert.deepEqual(routes.map((route: any) => route.handler), [
      `${model.uid}.find`, `${model.uid}.findOne`,
    ]);
  } finally { (globalThis as any).strapi = previous; }
});

test('bootstrap does not grant unused generic UAT write permissions', () => {
  for (const action of ['create', 'update', 'delete']) {
    assert.equal(EXPOSED_ACTIONS.includes(`api::public-uat-session.public-uat-session.${action}`), false);
  }
});

test('signed public result submission and completion routes remain available', () => {
  assert.ok(publicActions.routes.some(route => route.handler === 'public-uat-session.submitPublicResult'));
  assert.ok(publicActions.routes.some(route => route.handler === 'public-uat-session.completePublicSession'));
});
