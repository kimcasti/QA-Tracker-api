export function fixture() {
  const memberships = [
    { documentId: 'mA', isActive: true, organization: { documentId: 'A' }, organizationRole: { code: 'owner' } },
    { documentId: 'mB', isActive: true, organization: { documentId: 'B' }, organizationRole: { code: 'viewer' } },
  ];
  const projects: Record<string, any> = {
    pA: { documentId: 'pA', organization: { documentId: 'A' } },
    pA2: { documentId: 'pA2', organization: { documentId: 'A' } },
    pB: { documentId: 'pB', organization: { documentId: 'B' } },
    pB2: { documentId: 'pB2', organization: { documentId: 'B' } },
    pX: { documentId: 'pX', organization: { documentId: 'X' } },
  };
  const entities: Record<string, any> = {
    own: { documentId: 'own', organization: { documentId: 'A' }, project: { documentId: 'pA' } },
    viewer: { documentId: 'viewer', organization: { documentId: 'B' }, project: { documentId: 'pB' } },
    restricted: { documentId: 'restricted', organization: { documentId: 'B' }, project: { documentId: 'pB2' } },
    foreign: { documentId: 'foreign', organization: { documentId: 'X' }, project: { documentId: 'pX' } },
  };
  const calls: string[] = [];
  const strapi = {
    db: { query: () => ({ findOne: async () => ({ email: 'user@example.test' }) }) },
    documents: (uid: string) => ({
      findMany: async () => uid.includes('organization-membership') ? memberships : uid.includes('organization-invitation') ? [{ workspaceProjectDocumentIds: ['pB'] }] : [],
      findFirst: async () => null,
      findOne: async ({ documentId }: any) => { calls.push(`${uid}:${documentId}`); return uid === 'api::project.project' ? projects[documentId] ?? null : entities[documentId] ?? null; },
      create: async ({ data }: any) => { calls.push('create'); return { documentId: 'created', ...data }; },
      update: async ({ data }: any) => { calls.push('update'); return data; },
    }),
  };
  return { strapi: strapi as any, memberships, projects, entities, calls };
}

export function context(documentId?: string, data: Record<string, unknown> = {}, method = 'PUT') {
  return { state: { user: { id: 1 } }, params: { documentId }, query: {} as any, request: { method, body: { data } } };
}
