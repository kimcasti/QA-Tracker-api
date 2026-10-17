import test from 'node:test';
import assert from 'node:assert/strict';
import middlewareConfig from '../../../../config/middlewares';
import authRoutes from '../routes/auth';

test('password-based invitation acceptance uses the existing auth rate limiter', () => {
  const route = authRoutes.routes.find(route => route.path === '/auth/invitations/accept');
  assert.ok((route?.config as any).middlewares?.includes('plugin::users-permissions.rateLimit'));
});

test('CORS allows the invitation proof header used by the public metadata request', () => {
  const config = middlewareConfig({ env: { array: (_key: string, fallback: any) => fallback } } as any);
  const cors = config.find((item: any) => item?.name === 'strapi::cors') as any;
  assert.ok(cors.config.headers.includes('X-Invitation-Token'));
});
