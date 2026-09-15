import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  disconnectOAuth,
  oauthAccountUid,
  refreshOAuthProfile,
  resolveOAuthCredentials,
} from './jira-oauth';

const REPORT_URL = 'https://api.atlassian.com/app/report-accounts/';
const MAX_ACCOUNTS_PER_REQUEST = 90;
const DEFAULT_CYCLE_MS = 7 * 24 * 60 * 60 * 1000;

type OAuthAccount = {
  id: number;
  userId: number;
  state: string;
  accountId?: string | null;
  personalDataUpdatedAt?: string | null;
  privacyReportDueAt?: string | null;
  updatedAt?: string | null;
};

type ReportStatus = { accountId?: unknown; status?: unknown };

function configuredReporterUserId(env = process.env) {
  if (env.JIRA_PRIVACY_REPORTING_ENABLED !== 'true') return null;
  const userId = Number(env.JIRA_PRIVACY_REPORTER_USER_ID);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new errors.ApplicationError(
      'JIRA_PRIVACY_REPORTER_USER_ID debe identificar la cuenta propietaria de la aplicacion OAuth.',
    );
  }
  return userId;
}

function cycleMilliseconds(value: string | null) {
  if (!value) return DEFAULT_CYCLE_MS;
  if (/^\d+$/.test(value)) return Number(value) * 1000 || DEFAULT_CYCLE_MS;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(value);
  if (!match) return DEFAULT_CYCLE_MS;
  const milliseconds =
    Number(match[1] || 0) * 24 * 60 * 60 * 1000 +
    Number(match[2] || 0) * 60 * 60 * 1000 +
    Number(match[3] || 0) * 60 * 1000;
  return milliseconds || DEFAULT_CYCLE_MS;
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function reportBatch(
  token: string,
  accounts: OAuthAccount[],
  request: typeof fetch,
) {
  const response = await request(REPORT_URL, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      accounts: accounts.map(account => ({
        accountId: account.accountId,
        updatedAt: account.personalDataUpdatedAt || account.updatedAt,
      })),
    }),
  });

  if (!response.ok) {
    throw new errors.ApplicationError(
      `Atlassian no acepto el informe de datos personales (HTTP ${response.status}).`,
    );
  }

  const body: { accounts?: unknown } = response.status === 204
    ? {}
    : await response.json() as { accounts?: unknown };
  return {
    statuses: Array.isArray(body?.accounts) ? (body.accounts as ReportStatus[]) : [],
    cycleMs: cycleMilliseconds(response.headers.get('Cycle-Period')),
  };
}

async function hydrateAccountId(account: OAuthAccount, strapi: Core.Strapi) {
  if (account.accountId && account.personalDataUpdatedAt) return account;
  try {
    const profile = await refreshOAuthProfile(account.userId);
    if (!profile) return null;
    return { ...account, accountId: profile.accountId, personalDataUpdatedAt: profile.personalDataUpdatedAt };
  } catch (error) {
    strapi.log.warn(`No se pudo actualizar el perfil Jira para el reporte de privacidad del usuario ${account.userId}.`);
    return null;
  }
}

export async function runJiraPersonalDataReport({
  strapi,
  now = new Date(),
  request = fetch,
  env = process.env,
}: {
  strapi: Core.Strapi;
  now?: Date;
  request?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}) {
  const reporterUserId = configuredReporterUserId(env);
  if (!reporterUserId) return { enabled: false, reported: 0, disconnected: 0, refreshed: 0 };

  const reporterCredentials = await resolveOAuthCredentials(reporterUserId);
  if (!reporterCredentials) {
    throw new errors.ApplicationError(
      'La cuenta propietaria configurada para reportes de privacidad debe conectar Jira mediante OAuth.',
    );
  }

  const repository = strapi.db.query(oauthAccountUid as any);
  const activeAccounts = (await repository.findMany({ where: { state: 'active' } })) as OAuthAccount[];
  const dueAccounts = activeAccounts.filter(account =>
    !account.privacyReportDueAt || new Date(account.privacyReportDueAt).getTime() <= now.getTime(),
  );
  const accounts = (
    await Promise.all(dueAccounts.map(account => hydrateAccountId(account, strapi)))
  ).filter((account): account is OAuthAccount => Boolean(account?.accountId && account.personalDataUpdatedAt));

  let reported = 0;
  let disconnected = 0;
  let refreshed = 0;
  for (const batch of chunks(accounts, MAX_ACCOUNTS_PER_REQUEST)) {
    const { statuses, cycleMs } = await reportBatch(reporterCredentials.token, batch, request);
    const statusesByAccountId = new Map(
      statuses
        .filter(status => typeof status.accountId === 'string' && typeof status.status === 'string')
        .map(status => [status.accountId as string, status.status as string]),
    );

    for (const account of batch) {
      const status = statusesByAccountId.get(account.accountId!);
      if (status === 'closed') {
        await disconnectOAuth(account.userId);
        disconnected += 1;
        continue;
      }
      if (status === 'updated') {
        const profile = await refreshOAuthProfile(account.userId);
        if (!profile) {
          disconnected += 1;
          continue;
        }
        refreshed += 1;
      }
      await repository.updateMany({
        where: { id: account.id, state: 'active' },
        data: { privacyReportDueAt: new Date(now.getTime() + cycleMs).toISOString() },
      });
      reported += 1;
    }
  }

  return { enabled: true, reported, disconnected, refreshed };
}
