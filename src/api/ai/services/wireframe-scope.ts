import { errors } from '@strapi/utils';
import tenantAccess from '../../../policies/tenant-access';
import { MANAGE_ROLES, READ_ROLES } from '../../../utils/access';

export async function authorizeWireframeProject(strapi: any, userId: number, projectId: string, write: boolean, authorize = tenantAccess) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new errors.UnauthorizedError('Authentication is required.');
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new errors.ValidationError('Invalid projectId; use the project documentId.');
  const allowed = await authorize({state:{user:{id:userId}},params:{documentId:projectId},request:{method:write?'PUT':'GET',body:{data:{}}}},
    {contentTypeUid:'api::project.project',allowedRoles:write?MANAGE_ROLES:READ_ROLES},{strapi});
  if (!allowed) throw new errors.ForbiddenError('Project access denied.');
  const project = await strapi.documents('api::project.project').findOne({documentId:projectId,populate:{organization:true}});
  if (project?.documentId !== projectId || !project.organization?.documentId) throw new errors.NotFoundError('Project not found.');
  return project;
}
