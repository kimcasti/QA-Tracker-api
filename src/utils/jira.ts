import { errors } from '@strapi/utils';

export type JiraCredentials = { site: string; apiBase: string; email: string; token: string; userId: number; authType?: 'bearer'; onUnauthorized?: () => Promise<void> };

export function assertJiraWritesEnabled(env = process.env) {
  if (env.JIRA_ENABLE_WRITES !== 'true') throw new errors.ForbiddenError('El envío a Jira está deshabilitado. Primero revisa y aprueba el reporte de prueba.');
}

export function jiraCredentials(env = process.env): JiraCredentials | null {
  if (!env.JIRA_SITE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN || !env.JIRA_QA_USER_ID) return null;
  const site = new URL(env.JIRA_SITE_URL);
  if (site.protocol !== 'https:' || !/^[a-z0-9-]+\.atlassian\.net$/i.test(site.hostname) || site.port || site.username || site.password || site.pathname !== '/' || site.search || site.hash) {
    throw new errors.ValidationError('JIRA_SITE_URL debe ser el origen HTTPS de tu sitio atlassian.net.');
  }
  const userId = Number(env.JIRA_QA_USER_ID);
  if (!Number.isSafeInteger(userId) || userId < 1) throw new errors.ValidationError('JIRA_QA_USER_ID no es válido.');
  const cloudId = env.JIRA_CLOUD_ID?.trim();
  if (cloudId && !/^[a-zA-Z0-9-]+$/.test(cloudId)) throw new errors.ValidationError('JIRA_CLOUD_ID no es válido.');
  return { site: site.origin, apiBase: cloudId ? `https://api.atlassian.com/ex/jira/${cloudId}` : site.origin, email: env.JIRA_EMAIL.trim(), token: env.JIRA_API_TOKEN.trim(), userId };
}

export class JiraRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function jiraClient(credentials: JiraCredentials, request: typeof fetch = fetch) {
  return async <T = Record<string, any>>(resource: string, options: RequestInit = {}): Promise<T> => {
    if (!resource.startsWith('/rest/api/3/')) throw new Error('Invalid Jira API resource');
    const response = await request(`${credentials.apiBase}${resource}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json',
        ...options.headers,
        Authorization: credentials.authType === 'bearer' ? `Bearer ${credentials.token}` : `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString('base64')}`,
      },
    });
    if (!response.ok) {
      if (response.status === 401 && credentials.onUnauthorized) await credentials.onUnauthorized();
      // Do not relay response bodies: Jira may include submitted evidence or account details.
      const message = response.status === 401 ? 'Jira rechazó la cuenta o el token.'
        : response.status === 403 ? 'La cuenta no tiene permisos para esta operación en Jira.'
        : response.status === 400 ? 'Jira rechazó los campos del reporte. Revisa los requisitos del proyecto.'
        : `Jira no pudo completar la operación (HTTP ${response.status}).`;
      throw new JiraRequestError(response.status, message);
    }
    return response.json() as Promise<T>;
  };
}

export async function jiraPages(client: ReturnType<typeof jiraClient>, resource: string) {
  const values: any[] = [];
  for (let startAt = 0; ; ) {
    const page = await client(`${resource}${resource.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=50`);
    const items = page.values || page.issueTypes || [];
    values.push(...items);
    if (page.isLast || !items.length || (typeof page.total === 'number' && values.length >= page.total)) return values;
    startAt += items.length;
    if (startAt > 10000) throw new errors.ApplicationError('Demasiados resultados de Jira; limita los proyectos accesibles a la cuenta.');
  }
}

export function jiraDescription(text: string) {
  return { type: 'doc', version: 1, content: text.split(/\r?\n/).filter(Boolean).map(line => ({
    type: 'paragraph', content: [{ type: 'text', text: line }],
  })) };
}

export function jiraAttachment(value?: string) {
  if (!value) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 3 * 1024 * 1024) return null;
  return { bytes, mime: match[1], extension: match[1].split('/')[1] };
}

export function assertJiraProjectMembership(memberships: any[], organizationId: string, roles: readonly string[]) {
  if (!memberships.some(m => m.isActive && m.organization?.documentId === organizationId && m.organization?.status === 'active' && roles.includes(m.organizationRole?.code))) {
    throw new errors.ForbiddenError('Tu rol en esta organización no permite gestionar esta conexión de Jira.');
  }
}
