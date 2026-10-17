import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import controller from './superadmin';
import { verifyInvitationProof } from '../../../utils/invitation-tokens';

test('superadmin create and resend use the real email builder with hashed rotating invitation proof', async t => {
  const previousStrapi = globalThis.strapi;
  const env = { SMTP_HOST: 'smtp.invalid', SMTP_PORT: '587', SMTP_USER: '', SMTP_PASS: '',
    MAIL_FROM: 'qa@example.test', MAILTRAP_API_TOKEN: '', INVITATION_APP_URL: 'https://qa.example.test' };
  const oldEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const messages: any[] = [];
  // Delivery is the only non-DB mock: this transport cannot open a socket.
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (message: any) => { messages.push(message); }, close() {},
  }) as any);
  const organization = { id: 9, documentId: 'org-1', name: 'QA', status: 'active', plan: 'starter' };
  const role = { id: 7, documentId: 'role-1', code: 'viewer', name: 'Viewer' };
  let row: any;
  const strapi = {
    db: { query(uid: string) {
      if (uid === 'api::organization.organization') return { findOne: async () => organization };
      if (uid === 'plugin::users-permissions.user') return { findOne: async () => null };
      if (uid === 'api::organization-membership.organization-membership') return { count: async () => 0 };
      if (uid === 'api::superadmin-audit-log.superadmin-audit-log') return { create: async () => ({}) };
      if (uid === 'api::organization-invitation.organization-invitation') return {
        count: async () => 0,
        create: async ({ data }: any) => { row = { id: 10, documentId: 'inv-1', ...data }; return row; },
        findOne: async () => row ? { ...row, organization, organizationRole: role } : null,
        updateMany: async ({ where, data }: any) => {
          if (where.status !== row.status || where.tokenHash !== row.tokenHash) return { count: 0 };
          Object.assign(row, data); return { count: 1 };
        },
      };
      throw new Error(`Unexpected query ${uid}`);
    } },
    documents(uid: string) {
      if (uid === 'api::organization.organization') return { findFirst: async () => organization, findOne: async () => organization };
      if (uid === 'api::organization-role.organization-role') return { findFirst: async () => role };
      if (uid === 'api::organization-invitation.organization-invitation') return {
        findFirst: async () => null,
        findOne: async () => ({ ...row, organization, organizationRole: role }),
      };
      throw new Error(`Unexpected documents ${uid}`);
    },
    service: () => ({ invitations: async () => ({ invitations: [{ documentId: row.documentId, email: row.email }] }) }),
  } as any;
  globalThis.strapi = strapi;
  try {
    const ctx: any = { params: { documentId: 'org-1' }, state: { user: { id: 1 } },
      request: { body: { data: { email: 'invited@example.com', roleDocumentId: 'role-1' } } } };
    await controller.invite(ctx);
    const firstUrl = new URL(messages[0].text.match(/https:\/\/qa\.example\.test\/\?\S+/)[0]);
    const firstToken = new URLSearchParams(firstUrl.hash.slice(1)).get('invitationToken')!;
    assert.equal(row.tokenHash, createHash('sha256').update(firstToken).digest('hex'));
    assert.equal(row.invitationToken, undefined);
    const firstHash = row.tokenHash;
    ctx.params.documentId = 'inv-1';
    await controller.resendInvitation(ctx);
    assert.equal(messages.length, 2);
    assert.notEqual(row.tokenHash, firstHash);
    await assert.rejects(() => verifyInvitationProof(strapi, {
      documentId: 'inv-1', token: firstToken, email: row.email,
    }), /invalid or expired/i);
    const secondUrl = new URL(messages[1].text.match(/https:\/\/qa\.example\.test\/\?\S+/)[0]);
    const secondToken = new URLSearchParams(secondUrl.hash.slice(1)).get('invitationToken')!;
    const verified = await verifyInvitationProof(strapi, { documentId: 'inv-1', token: secondToken, email: row.email });
    assert.equal(verified.documentId, 'inv-1');
  } finally {
    globalThis.strapi = previousStrapi;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
