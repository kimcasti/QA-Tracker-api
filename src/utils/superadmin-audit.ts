type AuditInput = {
  actorUserId?: number | null;
  organizationDocumentId: string;
  action: string;
  targetType: string;
  targetDocumentId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown> | null;
};

async function getOrganizationDbId(documentId: string) {
  const organization = await strapi.db.query('api::organization.organization').findOne({
    where: { documentId },
  });

  return organization?.id || null;
}

export async function logSuperadminAudit(input: AuditInput) {
  const organizationId = await getOrganizationDbId(input.organizationDocumentId);

  if (!organizationId) return;

  await strapi.db.query('api::superadmin-audit-log.superadmin-audit-log').create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetDocumentId: input.targetDocumentId || null,
      targetLabel: input.targetLabel || null,
      details: input.details || null,
      organization: organizationId,
      actor: input.actorUserId || null,
    },
  });
}
