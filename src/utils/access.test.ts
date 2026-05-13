import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_ROLE_CODES,
  ADMIN_ROLES,
  ENGINEERING_ROLES,
  MANAGE_ROLES,
  OWNER_ROLES,
  READ_ROLES,
} from './access';

test('access role groups stay aligned with the supported role codes', () => {
  const allRoles = new Set(ACCESS_ROLE_CODES);

  for (const role of READ_ROLES) {
    assert.ok(allRoles.has(role), `READ_ROLES contains unsupported role "${role}"`);
  }

  for (const role of MANAGE_ROLES) {
    assert.ok(allRoles.has(role), `MANAGE_ROLES contains unsupported role "${role}"`);
    assert.ok(READ_ROLES.includes(role), `MANAGE_ROLES role "${role}" must also be readable`);
  }

  for (const role of ENGINEERING_ROLES) {
    assert.ok(allRoles.has(role), `ENGINEERING_ROLES contains unsupported role "${role}"`);
    assert.ok(MANAGE_ROLES.includes(role), `ENGINEERING_ROLES role "${role}" must also be manageable`);
  }

  for (const role of ADMIN_ROLES) {
    assert.ok(allRoles.has(role), `ADMIN_ROLES contains unsupported role "${role}"`);
    assert.ok(MANAGE_ROLES.includes(role), `ADMIN_ROLES role "${role}" must also be manageable`);
  }

  for (const role of OWNER_ROLES) {
    assert.ok(allRoles.has(role), `OWNER_ROLES contains unsupported role "${role}"`);
    assert.ok(ADMIN_ROLES.includes(role), `OWNER_ROLES role "${role}" must also be administrative`);
  }
});

test('owner remains the only owner-level role', () => {
  assert.deepEqual(OWNER_ROLES, ['owner']);
});
