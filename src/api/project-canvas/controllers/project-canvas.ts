import { randomUUID } from 'node:crypto';
import { errors } from '@strapi/utils';
import tenantAccess from '../../../policies/tenant-access';
import { MANAGE_ROLES, READ_ROLES } from '../../../utils/access';
import { normalizeCanvasState } from '../services/canvas-state';

export const CANVAS_UID = 'api::project-canvas.project-canvas';
export const emptyCanvasState = () => ({ version: 1, nodes: {}, notes: [], newElementColor: 'default' });

function targetId(ctx: any): string {
  const id = ctx.params?.documentId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new errors.ValidationError('Invalid Canvas project documentId.');
  }
  return id;
}

export function createCanvasController({ strapi, authorize = tenantAccess }: { strapi: any; authorize?: typeof tenantAccess }) {
  return {
    async update(ctx) {
      await authorize({ ...ctx, request: { method: 'PUT', body: { data: {} } } },
        { contentTypeUid: 'api::project.project', allowedRoles: MANAGE_ROLES }, { strapi });
      const projectDocumentId = targetId(ctx);
      const body = ctx.request.body;
      const plain = (value: any) => value && typeof value === 'object' && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
      if (!plain(body) || Object.keys(body).length !== 1 || !plain(body.data) ||
          Object.keys(body.data).length !== 2 || !Object.prototype.hasOwnProperty.call(body.data, 'state') ||
          !Number.isSafeInteger(body.data.revision) || body.data.revision < 0 ||
          body.data.revision >= 2147483647) {
        throw new errors.ValidationError('Invalid Canvas envelope or revision.');
      }
      const { revision, state: rawState } = body.data;
      const state = normalizeCanvasState(rawState);
      const project = await strapi.documents('api::project.project').findOne({ documentId: projectDocumentId, populate: { organization: true } });
      if (!project?.organization?.documentId) throw new errors.NotFoundError('Project not found.');
      const references = new Set([...Object.keys(state.nodes).filter(key => !key.startsWith('note:')),
        ...state.notes.flatMap(note => note.anchorId ? [note.anchorId] : [])]);
      const uids = { module: 'api::project-module.project-module', functionality: 'api::functionality.functionality', case: 'api::test-case.test-case' };
      const validateReferences = async (previous: ReturnType<typeof normalizeCanvasState>) => {
        for (const reference of references) {
          const [kind, documentId] = reference.split(':');
          const record = await strapi.documents(uids[kind]).findOne({ documentId, populate: { project: true, organization: true } });
          // Missing records may only conserve the exact persisted usage. An anchor on another
          // note (or an old node key) must never authorize attaching a new note to deleted data.
          if (record == null) {
            const retainedNode = !Object.prototype.hasOwnProperty.call(state.nodes, reference) ||
              Object.prototype.hasOwnProperty.call(previous.nodes, reference);
            const retainedAnchors = state.notes.filter(note => note.anchorId === reference).every(note =>
              previous.notes.some(old => old.id === note.id && old.anchorId === reference));
            if (retainedNode && retainedAnchors) continue;
          } else if (record.documentId === documentId && record.project?.documentId === projectDocumentId &&
              record.organization?.documentId === project.organization.documentId) {
            continue;
          }
          throw new errors.ValidationError('Canvas reference must belong to the exact project and organization.');
        }
      };
      const conflict = () => {
        ctx.status = 409;
        ctx.body = { error: { status: 409, name: 'ConflictError', message: 'Canvas changed. Reload before saving.' } };
      };
      await strapi.db.transaction(async ({ trx }) => {
        // Lock an existing stable parent, not a possibly absent Canvas row. This serializes first saves too.
        const table = strapi.db.metadata.get('api::project.project').tableName;
        const locked = await trx(table).where({ id: project.id }).forUpdate().first();
        if (!locked) throw new errors.NotFoundError('Project not found.');
        const currentProject = await strapi.documents('api::project.project').findOne({ documentId: projectDocumentId, populate: { organization: true } });
        if (!currentProject || currentProject.id !== project.id || currentProject.organization?.documentId !== project.organization.documentId) {
          throw new errors.NotFoundError('Project changed or no longer exists.');
        }
        await authorize({ ...ctx, request: { method: 'PUT', body: { data: {} } } },
          { contentTypeUid: 'api::project.project', allowedRoles: MANAGE_ROLES }, { strapi });
        const repository = strapi.db.query(CANVAS_UID);
        const row = await repository.findOne({ where: { projectKey: projectDocumentId }, populate: { project: true, organization: true } });
        if (row && (row.project?.id !== project.id || row.organization?.id !== project.organization.id ||
            !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 2147483647)) {
          throw new errors.ValidationError('Invalid Canvas stored scope or revision.');
        }
        if ((row?.revision ?? 0) !== revision) return conflict();
        // Only the scoped, allowlisted snapshot read under the parent lock at this revision
        // can authorize conservation. Never use pre-lock JSON as an authorization hint.
        await validateReferences(normalizeCanvasState(row ? row.state : emptyCanvasState()));
        if (row) {
          const result = await repository.updateMany({ where: { id: row.id, revision }, data: { revision: revision + 1, state } });
          if (result.count !== 1) return conflict();
        } else {
          await repository.create({ data: { documentId: randomUUID().replace(/-/g, ''), projectKey: projectDocumentId,
            project: project.id, organization: project.organization.id, revision: 1, state } });
        }
        ctx.body = { data: { projectDocumentId, revision: revision + 1, state } };
      });
    },
    async find(ctx) {
      await authorize({ ...ctx, request: { method: 'GET', body: { data: {} } } },
        { contentTypeUid: 'api::project.project', allowedRoles: READ_ROLES }, { strapi });
      const projectDocumentId = targetId(ctx);
      const project = await strapi.documents('api::project.project').findOne({ documentId: projectDocumentId, populate: { organization: true } });
      if (!project?.organization?.id) throw new errors.NotFoundError('Project not found.');
      const row = await strapi.db.query(CANVAS_UID).findOne({ where: { projectKey: projectDocumentId }, populate: { project: true, organization: true } });
      if (row && (row.project?.id !== project.id || row.organization?.id !== project.organization.id)) {
        throw new errors.ValidationError('Invalid Canvas stored scope.');
      }
      if (row && (!Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 2147483647)) {
        throw new errors.ValidationError('Invalid Canvas stored revision.');
      }
      ctx.body = { data: { projectDocumentId, revision: row?.revision ?? 0,
        state: row ? normalizeCanvasState(row.state) : emptyCanvasState() } };
    },
  };
}
export default ({ strapi }) => createCanvasController({ strapi });
