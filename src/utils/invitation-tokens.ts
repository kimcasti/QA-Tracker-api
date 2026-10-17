import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { errors } from '@strapi/utils';
import type { Core } from '@strapi/strapi';

export type InvitationProof = { documentId?: string; token?: string; email?: string; nowIso?: string };
const invalidProof = () => new errors.ValidationError('Invitation is invalid or expired. Request a new invitation email.');

export async function verifyInvitationProof(strapi: Core.Strapi, proof: InvitationProof) {
  if (typeof proof.documentId !== 'string' || !proof.documentId ||
      typeof proof.token !== 'string' || !/^[a-f0-9]{64}$/.test(proof.token)) throw invalidProof();
  const invitation = await strapi.db.query(INVITATION_UID as any).findOne({
    where: { documentId: proof.documentId }, populate: { organization: true, organizationRole: true },
  });
  const hash = createHash('sha256').update(proof.token).digest('hex');
  if (!invitation || invitation.documentId !== proof.documentId || invitation.status !== 'pending' ||
      !/^[a-f0-9]{64}$/.test(invitation.tokenHash || '') ||
      !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(invitation.tokenHash, 'hex')) ||
      !(Date.parse(invitation.tokenExpiresAt) > Date.parse(proof.nowIso || new Date().toISOString())) ||
      (proof.email !== undefined && invitation.email !== proof.email) ||
      !invitation.organization?.documentId || !invitation.organizationRole?.code) throw invalidProof();
  return invitation;
}

// Conditional single-row update is the cross-process replay barrier; a read followed
// by an unconditional document update would allow two simultaneous claimants.
export async function consumeInvitationProof(strapi: Core.Strapi, proof: InvitationProof) {
  const invitation = await verifyInvitationProof(strapi, proof);
  const result = await strapi.db.query(INVITATION_UID as any).updateMany({
    where: {
      documentId: invitation.documentId, email: invitation.email, status: 'pending',
      tokenHash: createHash('sha256').update(proof.token!).digest('hex'),
      tokenExpiresAt: { $gt: proof.nowIso || new Date().toISOString() },
    },
    // Retain the exact one-way hash as the claim marker; null expiry burns the
    // bearer secret without publishing project permissions or adding an enum.
    data: { status: 'pending', tokenHash: invitation.tokenHash, tokenExpiresAt: null },
  });
  if (result.count !== 1) throw invalidProof();
  // Preserve the claim identity even if an adapter returns a live row object.
  return { ...invitation, tokenHash: createHash('sha256').update(proof.token!).digest('hex') };
}

export const INVITATION_UID = 'api::organization-invitation.organization-invitation' as const;
export async function rotateInvitationSecretAndSend(
  strapi: Core.Strapi, documentId: string, send: (token: string) => Promise<unknown>,
  nowIso = new Date().toISOString(),
) {
  const query = strapi.db.query(INVITATION_UID as any);
  const row = await query.findOne({ where: { documentId } });
  if (!row) throw invalidProof();
  if (row.status === 'accepted') throw new errors.ValidationError('Invitation is already accepted.');
  const secret = createInvitationSecret(nowIso);
  const result = await query.updateMany({
    where: { documentId, status: row.status, tokenHash: row.tokenHash || null },
    data: { ...secret.data, status: 'pending', invitedAt: nowIso },
  });
  if (result.count !== 1) throw invalidProof();
  try {
    await send(secret.token);
  } catch (error) {
    // Never restore the previous link or erase a newer resend/acceptance.
    await query.updateMany({
      where: { documentId, status: 'pending', tokenHash: secret.data.tokenHash },
      data: { tokenHash: null, tokenExpiresAt: null },
    });
    throw error;
  }
}

export function createInvitationSecret(nowIso = new Date().toISOString()) {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      tokenExpiresAt: new Date(Date.parse(nowIso) + 48 * 60 * 60 * 1000).toISOString(),
    },
  };
}
