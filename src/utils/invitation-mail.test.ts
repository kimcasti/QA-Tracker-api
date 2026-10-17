import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInvitationAcceptanceUrl, buildInvitationEmail, getInvitationEmailHealth } from './mail';

test('mail health never recommends manufacturing a manual bearer link from a listing', () => {
  const keys = ['SMTP_HOST', 'MAIL_FROM', 'INVITATION_APP_URL'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', MAIL_FROM: 'qa@example.test',
      INVITATION_APP_URL: 'https://replace_with_client_public_url' });
    const health = getInvitationEmailHealth();
    assert.equal(health.summary?.includes('Comparte el enlace manual'), false);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('emailed invitation links carry the secret in a fragment, not the query, and require proof', () => {
  const token = 'ab'.repeat(32);
  const url = new URL(buildInvitationAcceptanceUrl('inv-1', token));
  assert.equal(url.searchParams.get('invitation'), 'inv-1');
  assert.equal(url.searchParams.has('invitationToken'), false);
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('invitationToken'), token);
  const message = buildInvitationEmail({ invitationDocumentId: 'inv-1', invitationToken: token,
    recipientEmail: 'qa@example.com', organizationName: 'QA', roleName: 'Viewer' });
  assert.ok(message.text.includes(url.toString()));
  assert.throws(() => buildInvitationAcceptanceUrl('inv-1', ''), /token/i);
});

test('invitation proof storage fields are private and legacy invitations remain schema-compatible', () => {
  const schema = JSON.parse(readFileSync(new URL('../api/organization-invitation/content-types/organization-invitation/schema.json', import.meta.url), 'utf8'));
  for (const field of ['tokenHash', 'tokenExpiresAt']) {
    assert.equal(schema.attributes[field]?.private, true);
    assert.notEqual(schema.attributes[field]?.required, true);
  }
});
