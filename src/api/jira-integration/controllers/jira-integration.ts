import { errors } from '@strapi/utils';
import { getUserMemberships } from '../../../utils/tenant';
import { ADMIN_ROLES, ENGINEERING_ROLES } from '../../../utils/access';
import { resolveJiraCredentials } from '../../../utils/jira-account';
import { assertJiraProjectMembership, assertJiraWritesEnabled, jiraAttachment, jiraClient, jiraDescription, jiraPages, JiraRequestError } from '../../../utils/jira';

async function context(ctx, configure = false) {
  const userId = ctx.state.user?.id;
  if (!userId) throw new errors.UnauthorizedError('Inicia sesión en QA Tracker.');
  const project = await strapi.documents('api::project.project').findFirst({
    filters: { key: ctx.params.projectKey }, populate: { organization: true },
  }) as any;
  if (!project?.organization?.documentId) throw new errors.NotFoundError('Proyecto no encontrado.');
  const memberships = await getUserMemberships(strapi, userId);
  assertJiraProjectMembership(memberships, project.organization.documentId, configure ? ADMIN_ROLES : ENGINEERING_ROLES);
  const savedConnection = await strapi.db.query('api::jira-connection.jira-connection' as any).findOne({ where: { projectId: project.documentId, organizationId: project.organization.documentId } });
  project.jiraIntegration = savedConnection?.destination || null;
  const credentials = await resolveJiraCredentials(userId);
  return { userId, project, credentials };
}

function connection(credentials) {
  if (!credentials) throw new errors.ValidationError('Conecta tu cuenta en Configuración → Integraciones → Jira.');
  return jiraClient(credentials);
}

async function issueTypes(client: ReturnType<typeof jiraClient>, projectId: string) {
  return (await jiraPages(client, `/rest/api/3/issue/createmeta/${encodeURIComponent(projectId)}/issuetypes`))
    .filter(type => !type.subtask).map(type => ({ id: String(type.id), name: type.name }));
}

function guarded(action) {
  return async ctx => {
    try { await action(ctx); }
    catch (error) {
      if (error instanceof JiraRequestError) throw new errors.ApplicationError(error.message);
      if (error?.name === 'TimeoutError' || error?.name === 'TypeError') throw new errors.ApplicationError('No pudimos comunicarnos con Jira. Comprueba la conexión.');
      throw error;
    }
  };
}

export default {
  status: guarded(async ctx => {
    const { project, credentials } = await context(ctx);
    ctx.body = { data: { configured: Boolean(credentials), sendingEnabled: process.env.JIRA_ENABLE_WRITES === 'true', site: credentials?.site || null, destination: project.jiraIntegration || null } };
  }),
  projects: guarded(async ctx => {
    const { credentials } = await context(ctx, true);
    const client = connection(credentials);
    const account = await client('/rest/api/3/myself');
    const projects = await jiraPages(client, '/rest/api/3/project/search?action=create');
    ctx.body = { data: { accountName: account.displayName, projects: projects.map(p => ({ id: String(p.id), key: p.key, name: p.name })) } };
  }),
  types: guarded(async ctx => {
    const { credentials } = await context(ctx, true);
    ctx.body = { data: await issueTypes(connection(credentials), ctx.params.jiraProjectId) };
  }),
  configure: guarded(async ctx => {
    const { project, credentials, userId } = await context(ctx, true);
    const client = connection(credentials);
    const { projectId, issueTypeId } = ctx.request.body?.data || {};
    if (!projectId || !issueTypeId) throw new errors.ValidationError('Selecciona el proyecto y el tipo de incidencia de Jira.');
    const target = await client(`/rest/api/3/project/${encodeURIComponent(String(projectId))}`);
    const type = (await issueTypes(client, String(target.id))).find(t => t.id === String(issueTypeId));
    if (!type) throw new errors.ValidationError('El tipo de incidencia no está disponible para este proyecto.');
    const destination = { site: credentials.site, projectId: String(target.id), projectKey: target.key, projectName: target.name, issueTypeId: type.id, issueTypeName: type.name, userId };
    const connections = strapi.db.query('api::jira-connection.jira-connection' as any);
    const existing = await connections.findOne({ where: { projectId: project.documentId } });
    const data = { projectId: project.documentId, organizationId: project.organization.documentId, userId, destination };
    if (existing) await connections.update({ where: { id: existing.id }, data });
    else await connections.create({ data });
    ctx.body = { data: destination };
  }),
  createIssue: guarded(async ctx => {
    assertJiraWritesEnabled();
    const { project, credentials, userId } = await context(ctx);
    const client = connection(credentials);
    const destination = project.jiraIntegration;
    if (!destination || destination.site !== credentials.site) throw new errors.ValidationError('Configura el destino de Jira del proyecto y verifica que coincida con el sitio de tu cuenta.');
    const payload = ctx.request.body?.data || {};
    const title = String(payload.title || '').trim();
    if (!title || title.length > 255) throw new errors.ValidationError('El título es obligatorio y admite hasta 255 caracteres.');
    const result = await strapi.documents('api::test-run-result.test-run-result').findFirst({
      filters: { testRun: { documentId: String(payload.testRunId || '') }, testCase: { documentId: String(payload.testCaseId || '') }, project: { documentId: project.documentId }, organization: { documentId: project.organization.documentId } },
    }) as any;
    if (!payload.testRunId || !payload.testCaseId || !result) throw new errors.ValidationError('Guarda la ejecución y su resultado antes de crear el reporte en Jira.');
    const exportKey = `${payload.testRunId}:${payload.testCaseId}`;
    const repository = strapi.db.query('api::jira-export.jira-export' as any);
    let record = await repository.findOne({ where: { exportKey } });
    const respond = async (entry, warning?: string) => {
      await strapi.documents('api::test-run-result.test-run-result').update({ documentId: result.documentId, data: { bugLink: entry.issueUrl, bugTitle: title } });
      ctx.body = { data: { key: entry.issueKey, url: entry.issueUrl, warning: warning || (entry.attachmentState === 'failed' ? 'El ticket existe, pero la captura no se adjuntó. Puedes subirla desde Jira.' : null) } };
    };
    if (record?.state === 'created') return respond(record);
    if (record && record.state !== 'rejected') throw new errors.ApplicationError('Este envío está en curso o su resultado es incierto. Revisa Jira antes de volver a enviarlo para evitar duplicados.');
    // The unique key is the database lock, including simultaneous requests or restarts.
    if (record) {
      const claimed = await repository.updateMany({ where: { id: record.id, state: 'rejected' }, data: { state: 'processing' } });
      if (!claimed.count) throw new errors.ApplicationError('El reporte ya se está enviando.');
    } else {
      try { record = await repository.create({ data: { exportKey, organizationId: project.organization.documentId, projectId: project.documentId, userId, state: 'processing', attachmentState: 'none' } }); }
      catch { throw new errors.ApplicationError('El reporte ya se está enviando. Consulta la ejecución antes de reintentar.'); }
    }
    let issue;
    try {
      const text = String(payload.description || '').slice(0, 16000);
      issue = await client('/rest/api/3/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {
        project: { id: destination.projectId }, issuetype: { id: destination.issueTypeId }, summary: title,
        ...(text.trim() ? { description: jiraDescription(text) } : {}),
      } }) });
      if (!issue.key || !/^[A-Z][A-Z0-9_]*-\d+$/i.test(issue.key)) throw new Error('Invalid issue response');
    } catch (error) {
      const rejected = error instanceof JiraRequestError && [400, 401, 403, 404, 422, 429].includes(error.status);
      await repository.update({ where: { id: record.id }, data: { state: rejected ? 'rejected' : 'uncertain' } });
      if (!rejected) throw new errors.ApplicationError('No se pudo confirmar si Jira creó el ticket. Revisa Jira antes de reintentar; el envío quedó bloqueado para evitar duplicados.');
      throw error;
    }
    const issueUrl = `${credentials.site}/browse/${issue.key}`;
    record = await repository.update({ where: { id: record.id }, data: { state: 'created', issueKey: issue.key, issueUrl } });
    // Persist the link before attaching images; an attachment failure never recreates the issue.
    await respond(record);
    if (payload.evidenceImage) {
      try {
        const image = jiraAttachment(String(payload.evidenceImage));
        if (!image) throw new Error('Unsupported attachment');
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `evidencia.${image.extension}`);
        await client(`/rest/api/3/issue/${encodeURIComponent(issue.key)}/attachments`, { method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form });
        await repository.update({ where: { id: record.id }, data: { attachmentState: 'uploaded' } });
      } catch {
        await repository.update({ where: { id: record.id }, data: { attachmentState: 'failed' } });
        ctx.body.data.warning = 'El ticket se creó, pero la captura no se adjuntó. Puedes subirla desde Jira.';
      }
    }
  }),
};
