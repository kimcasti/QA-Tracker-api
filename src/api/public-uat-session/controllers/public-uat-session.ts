import crypto from 'crypto';
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { ADMIN_ROLES } from '../../../utils/access';
import { getUserMemberships } from '../../../utils/tenant';

type PublicUatSessionPayload = {
  externalParticipant?: unknown;
  participantNameSnapshot?: string | null;
  participantEmailSnapshot?: string | null;
  deliveryNotes?: string | null;
  allowResultEditing?: boolean;
  allowEvidenceUpload?: boolean;
  allowCommentEditing?: boolean;
  expiresAt?: string | null;
};

type PublicResultPayload = {
  result?: 'passed' | 'failed' | 'blocked' | 'not_executed';
  notes?: string | null;
  evidenceImage?: string | null;
};

function normalizeUrl(value?: string) {
  return String(value || '').trim().replace(/\/$/, '');
}

function getAppUrl() {
  return normalizeUrl(
    process.env.PUBLIC_UAT_APP_URL || process.env.INVITATION_APP_URL || process.env.APP_URL || 'http://localhost:3000',
  );
}

function getTokenSecret() {
  const appKey = String(process.env.APP_KEYS || '')
    .split(',')
    .map(value => value.trim())
    .find(Boolean);

  return (
    process.env.PUBLIC_UAT_TOKEN_SECRET?.trim() ||
    appKey ||
    process.env.JWT_SECRET?.trim() ||
    process.env.API_TOKEN_SALT?.trim() ||
    'qa-tracker-public-uat-dev-secret'
  );
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signTokenPayload(payload: string) {
  return crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('base64url');
}

function buildSessionToken(sessionDocumentId: string, activatedAt: string) {
  const activatedAtMs = new Date(activatedAt).getTime();
  const payload = `${sessionDocumentId}.${activatedAtMs}`;
  const signature = signTokenPayload(payload);
  return `${payload}.${signature}`;
}

function buildPublicSessionUrl(token: string) {
  return `${getAppUrl()}/uat/${encodeURIComponent(token)}`;
}

function getDefaultExpirationIso() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString();
}

function parseFutureExpiration(value: unknown): string {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  if (match) {
    const [, year, month, day, hour, minute, second, zone] = match;
    const y = Number(year);
    const m = Number(month);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const validZone = zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59);
    const ms = Date.parse(value as string);
    if (y >= 1 && m >= 1 && m <= 12 && Number(day) >= 1 && Number(day) <= days[m - 1] &&
        Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 &&
        validZone && Number.isFinite(ms) && ms > Date.now()) {
      return new Date(ms).toISOString();
    }
  }
  throw new errors.ValidationError('expiresAt must be a valid future ISO timestamp with timezone.');
}

function parsePublicToken(rawToken: string) {
  const token = String(rawToken || '').trim();
  const [sessionDocumentId, activatedAtMsRaw, signature] = token.split('.');

  if (!sessionDocumentId || !activatedAtMsRaw || !signature) {
    throw new errors.ValidationError('Invalid public UAT token.');
  }

  const activatedAtMs = Number(activatedAtMsRaw);
  if (!Number.isFinite(activatedAtMs) || activatedAtMs <= 0) {
    throw new errors.ValidationError('Invalid public UAT token.');
  }

  return {
    token,
    sessionDocumentId,
    activatedAtMs,
    signature,
  };
}

function extractRelationDocumentId(rawValue: unknown): string | null {
  if (!rawValue) return null;
  if (typeof rawValue === 'string') return rawValue;

  if (typeof rawValue === 'object') {
    const value = rawValue as {
      documentId?: string;
      connect?: Array<{ documentId?: string }>;
    };

    if (value.documentId) return value.documentId;
    if (Array.isArray(value.connect) && value.connect[0]?.documentId) {
      return value.connect[0].documentId;
    }
  }

  return null;
}

async function ensureAdminAccessForOrganization(userId: number, organizationDocumentId?: string | null) {
  const memberships = await getUserMemberships(strapi, userId);
  const matchingMembership = memberships.find(
    membership => membership.organization?.documentId === organizationDocumentId,
  );

  if (!matchingMembership?.organization?.documentId) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  if (!ADMIN_ROLES.includes((matchingMembership.organizationRole?.code || '') as any)) {
    throw new errors.ForbiddenError('Only Owner or QA Lead can manage public UAT sessions.');
  }

  return matchingMembership;
}

async function getTestRunForSession(testRunDocumentId: string) {
  return strapi.documents('api::test-run.test-run').findOne({
    documentId: testRunDocumentId,
    populate: {
      organization: true,
      project: true,
      sprint: true,
      results: {
        sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
        populate: {
          functionality: true,
          testCase: true,
          bug: true,
        },
      },
      publicUatSession: {
        populate: {
          externalParticipant: true,
        },
      },
    },
  });
}

async function getSessionByTestRun(testRunDocumentId: string) {
  return strapi.documents('api::public-uat-session.public-uat-session' as any).findFirst({
    filters: {
      testRun: {
        documentId: testRunDocumentId,
      },
    },
    populate: {
      organization: true,
      project: true,
      testRun: {
        populate: {
          results: {
            sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
            populate: {
              functionality: true,
              testCase: true,
            },
          },
        },
      },
      externalParticipant: true,
    },
  });
}

async function getSessionByDocumentId(sessionDocumentId: string) {
  return strapi.documents('api::public-uat-session.public-uat-session' as any).findOne({
    documentId: sessionDocumentId,
    populate: {
      organization: true,
      project: true,
      testRun: {
        populate: {
          sprint: true,
          results: {
            sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
            populate: {
              functionality: { populate: { module: { fields: ['name'] } } },
              testCase: true,
              bug: true,
            },
          },
        },
      },
      externalParticipant: true,
    },
  });
}

async function validatePublicSessionToken(rawToken: string, lockedSession?: any) {
  const parsed = parsePublicToken(rawToken);
  const session = lockedSession ?? await getSessionByDocumentId(parsed.sessionDocumentId);

  if (!session?.documentId) {
    throw new errors.NotFoundError('Public UAT session not found.');
  }

  if (!session.activatedAt) {
    throw new errors.ForbiddenError('This public UAT session is not active.');
  }

  const expectedToken = buildSessionToken(session.documentId, session.activatedAt);
  const expectedSignature = expectedToken.split('.').slice(2).join('.');
  const expectedHash = sha256(expectedToken);
  const providedHash = sha256(parsed.token);
  const signatureMatches =
    expectedSignature.length === parsed.signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(parsed.signature));
  const hashMatches =
    expectedHash.length === providedHash.length &&
    crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(providedHash));

  if (!signatureMatches || !hashMatches || session.tokenHash !== expectedHash) {
    throw new errors.ForbiddenError('Invalid public UAT token.');
  }

  const now = new Date();
  if (session.expiresAt && new Date(session.expiresAt) < now) {
    throw new errors.ForbiddenError('This public UAT session has expired.');
  }

  if (session.status === 'revoked') {
    throw new errors.ForbiddenError('This public UAT session is no longer available.');
  }

  if (!['active', 'completed'].includes(String(session.status || ''))) {
    throw new errors.ForbiddenError('This public UAT session is not available.');
  }

  return session;
}

function mapPublicResultItem(result: any) {
  return {
    documentId: result.documentId,
    orderIndex:
      typeof result.orderIndex === 'number' && Number.isFinite(result.orderIndex)
        ? result.orderIndex
        : null,
    result: result.result,
    notes: result.notes || '',
    evidenceImage: result.evidenceImage || null,
    functionality: result.functionality
      ? {
          documentId: result.functionality.documentId,
          code: result.functionality.code || null,
          name: result.functionality.name || '',
          module: result.functionality.module?.name || '',
        }
      : null,
    testCase: result.testCase
      ? {
          documentId: result.testCase.documentId,
          title: result.testCase.title || '',
          description: result.testCase.description || '',
          preconditions: result.testCase.preconditions || '',
          testSteps: result.testCase.testSteps || '',
          expectedResult: result.testCase.expectedResult || '',
        }
      : null,
  };
}

function mapSessionStatusResponse(session: any) {
  const expired = Boolean(session.expiresAt) && !(Date.parse(session.expiresAt) > Date.now());
  const status = session.status === 'expired' && session.completedAt
    ? 'completed'
    : session.status === 'active' && expired ? 'expired' : session.status;
  const token =
    session.documentId && session.activatedAt && !expired && !session.revokedAt &&
      ['active', 'completed'].includes(session.status)
      ? buildSessionToken(session.documentId, session.activatedAt)
      : null;

  return {
    documentId: session.documentId,
    status,
    expiresAt: session.expiresAt || null,
    activatedAt: session.activatedAt || null,
    completedAt: session.completedAt || null,
    revokedAt: session.revokedAt || null,
    lastAccessedAt: session.lastAccessedAt || null,
    allowResultEditing: Boolean(session.allowResultEditing),
    allowEvidenceUpload: Boolean(session.allowEvidenceUpload),
    allowCommentEditing: Boolean(session.allowCommentEditing),
    completionLocked: Boolean(session.completionLocked),
    participant: {
      documentId: session.externalParticipant?.documentId || null,
      name: session.participantNameSnapshot || session.externalParticipant?.name || '',
      email: session.participantEmailSnapshot || session.externalParticipant?.email || '',
      role: session.externalParticipant?.role || '',
    },
    testRun: session.testRun
      ? {
          documentId: session.testRun.documentId,
          title: session.testRun.title,
          executionDate: session.testRun.executionDate || null,
          status: session.testRun.status,
          testType: session.testRun.testType,
        }
      : null,
    publicUrl: token ? buildPublicSessionUrl(token) : null,
  };
}

function mapPublicSessionResponse(session: any) {
  const testRun = session.testRun;
  return {
    session: {
      documentId: session.documentId,
      status: session.status,
      expiresAt: session.expiresAt || null,
      activatedAt: session.activatedAt || null,
      completedAt: session.completedAt || null,
      readOnly: session.status === 'completed' || Boolean(session.completionLocked),
      allowResultEditing: Boolean(session.allowResultEditing),
      allowEvidenceUpload: Boolean(session.allowEvidenceUpload),
      allowCommentEditing: Boolean(session.allowCommentEditing),
      participantName:
        session.participantNameSnapshot || session.externalParticipant?.name || 'Cliente invitado',
      participantEmail:
        session.participantEmailSnapshot || session.externalParticipant?.email || null,
      deliveryNotes: session.deliveryNotes || '',
    },
    testRun: testRun
      ? {
          documentId: testRun.documentId,
          title: testRun.title,
          description: testRun.description || '',
          executionDate: testRun.executionDate || null,
          status: testRun.status,
          testType: testRun.testType,
          priority: testRun.priority,
          tester: testRun.tester || '',
          environment: testRun.environment || null,
          buildVersion: testRun.buildVersion || null,
          sprint: testRun.sprint
            ? {
                documentId: testRun.sprint.documentId,
                name: testRun.sprint.name || '',
              }
            : null,
          results: Array.isArray(testRun.results) ? testRun.results.map(mapPublicResultItem) : [],
        }
      : null,
  };
}

// Lock in a stable run → session order, then authorize the fresh persisted relations.
// Strapi's database transaction context automatically enlists document operations.
async function getLockedSession(trx: any, runId: string) {
  if (!runId) throw new errors.ValidationError('Test run is required.');
  const runTable = strapi.db.metadata.get('api::test-run.test-run').tableName;
  await trx(runTable).where({ document_id: runId }).forUpdate().first();
  const testRun = await getTestRunForSession(runId);
  if (!testRun?.documentId || testRun.documentId !== runId ||
      !testRun.organization?.documentId || !testRun.project?.documentId) {
    throw new errors.NotFoundError('Test run not found.');
  }
  let session = await getSessionByTestRun(runId);
  if (!session?.documentId) throw new errors.NotFoundError('Public UAT session not found.');
  const sessionId = session.documentId;
  const sessionMetadata = strapi.db.metadata.get('api::public-uat-session.public-uat-session');
  const lockedSession = await trx(sessionMetadata.tableName).where({ document_id: sessionId }).forUpdate().first();
  session = await getSessionByTestRun(runId);
  // A locking read is current even when MySQL's document-service read view is older.
  const updatedAtColumn = (sessionMetadata.attributes.updatedAt as { columnName: string }).columnName;
  if (!lockedSession || lockedSession.status !== session?.status ||
      new Date(lockedSession[updatedAtColumn]).getTime() !== new Date(session?.updatedAt).getTime()) {
    throw new errors.ValidationError('Public UAT session changed. Refresh before trying again.');
  }
  const project = await strapi.documents('api::project.project').findOne({
    documentId: testRun.project.documentId,
    populate: { organization: true },
  });
  if (!session?.documentId || session.documentId !== sessionId ||
      session.organization?.documentId !== testRun.organization.documentId ||
      session.project?.documentId !== testRun.project.documentId ||
      session.testRun?.documentId !== testRun.documentId ||
      testRun.publicUatSession?.documentId !== session.documentId ||
      project?.documentId !== testRun.project.documentId ||
      project?.organization?.documentId !== testRun.organization.documentId) {
    throw new errors.ForbiddenError('Public UAT session relations do not match this test run.');
  }
  if (testRun.testType !== 'uat') throw new errors.ValidationError('Only UAT sessions can be managed.');
  return { testRun, session };
}

async function getManagedSession(trx: any, userId: number, runId: string) {
  const locked = await getLockedSession(trx, runId);
  await ensureAdminAccessForOrganization(userId, locked.testRun.organization.documentId);
  return locked;
}

function hasPendingPublicResults(session: any) {
  return Array.isArray(session?.testRun?.results)
    ? session.testRun.results.some((result: any) => result.result === 'not_executed')
    : true;
}

export default factories.createCoreController(
  'api::public-uat-session.public-uat-session' as any,
  () => ({
    async activate(ctx) {
      const userId = ctx.state.user?.id;
      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const testRunDocumentId = String(ctx.params.documentId || '').trim();
      if (!testRunDocumentId) {
        throw new errors.ValidationError('Test run is required.');
      }

      const testRun = await getTestRunForSession(testRunDocumentId);
      if (!testRun?.documentId || !testRun.organization?.documentId || !testRun.project?.documentId) {
        throw new errors.NotFoundError('Test run not found.');
      }

      await ensureAdminAccessForOrganization(userId, testRun.organization.documentId);

      if (testRun.testType !== 'uat') {
        throw new errors.ValidationError('Only UAT test runs can be published as public sessions.');
      }

      if (!Array.isArray(testRun.results) || testRun.results.length === 0) {
        throw new errors.ValidationError(
          'The UAT test run must include at least one selected case before publishing the public session.',
        );
      }

      const payload = (ctx.request.body?.data || {}) as PublicUatSessionPayload;
      const externalParticipantDocumentId = extractRelationDocumentId(payload.externalParticipant);
      if (externalParticipantDocumentId) {
        const participant = await strapi.documents('api::external-participant.external-participant').findFirst({
          filters: {
            documentId: externalParticipantDocumentId,
            organization: { documentId: testRun.organization.documentId },
            // Organization-wide contacts have no source project; project contacts stay scoped.
            $or: [
              { sourceProject: { documentId: testRun.project.documentId } },
              { sourceProject: { id: { $null: true } } },
            ],
          },
          fields: ['documentId'],
        });
        if (!participant) {
          throw new errors.ValidationError('External participant is not available for this test run.');
        }
      }
      const nowIso = new Date().toISOString();
      const expiresAt = String(payload.expiresAt || '').trim() || getDefaultExpirationIso();
      const participantNameSnapshot = String(payload.participantNameSnapshot || '').trim() || null;
      const participantEmailSnapshot =
        String(payload.participantEmailSnapshot || '').trim().toLowerCase() || null;

      let existingSession = await getSessionByTestRun(testRunDocumentId);

      if (!existingSession?.documentId) {
        existingSession = await strapi.documents('api::public-uat-session.public-uat-session' as any).create({
          data: {
            status: 'draft',
            tokenHash: `pending-${crypto.randomUUID()}`,
            organization: testRun.organization.documentId,
            project: testRun.project.documentId,
            testRun: testRun.documentId,
            externalParticipant: externalParticipantDocumentId,
            participantNameSnapshot,
            participantEmailSnapshot,
            deliveryNotes: String(payload.deliveryNotes || '').trim() || null,
            allowResultEditing: payload.allowResultEditing ?? true,
            allowEvidenceUpload: payload.allowEvidenceUpload ?? true,
            allowCommentEditing: payload.allowCommentEditing ?? true,
            completionLocked: false,
          },
          populate: {
            organization: true,
            project: true,
            testRun: true,
            externalParticipant: true,
          },
        });
      }

      const token = buildSessionToken(existingSession.documentId, nowIso);
      const tokenHash = sha256(token);
      const updated = await strapi.documents('api::public-uat-session.public-uat-session' as any).update({
        documentId: existingSession.documentId,
        data: {
          status: 'active',
          tokenHash,
          activatedAt: nowIso,
          expiresAt,
          completedAt: null,
          revokedAt: null,
          completionLocked: false,
          externalParticipant: externalParticipantDocumentId,
          participantNameSnapshot,
          participantEmailSnapshot,
          deliveryNotes: String(payload.deliveryNotes || '').trim() || null,
          allowResultEditing: payload.allowResultEditing ?? true,
          allowEvidenceUpload: payload.allowEvidenceUpload ?? true,
          allowCommentEditing: payload.allowCommentEditing ?? true,
        },
        populate: {
          organization: true,
          project: true,
          testRun: {
            populate: {
              results: true,
            },
          },
          externalParticipant: true,
        },
      });

      ctx.body = {
        data: {
          ...mapSessionStatusResponse(updated),
          token,
          publicUrl: buildPublicSessionUrl(token),
        },
      };
    },

    async reopen(ctx) {
      const userId = ctx.state.user?.id;
      if (!userId) throw new errors.UnauthorizedError('Authentication is required.');
      const data = await strapi.db.transaction(async ({ trx }) => {
        const runId = String(ctx.params.documentId || '').trim();
        const { testRun, session } = await getManagedSession(trx, userId, runId);
        if (!session.activatedAt || !session.tokenHash || session.revokedAt ||
            !['active', 'completed', 'expired'].includes(session.status) ||
            (session.status === 'active' && !session.completionLocked &&
              (!session.expiresAt || Date.parse(session.expiresAt) > Date.now()))) {
          throw new errors.ValidationError('This public UAT session cannot be reopened.');
        }
        const requestedExpiration = ctx.request.body?.data?.expiresAt;
        const expiresAt = typeof requestedExpiration !== 'undefined'
          ? parseFutureExpiration(requestedExpiration)
          : (session.expiresAt || session.status === 'expired') ? parseFutureExpiration(session.expiresAt) : undefined;
        await strapi.documents('api::public-uat-session.public-uat-session' as any).update({
          documentId: session.documentId,
          data: { status: 'active', completionLocked: false, completedAt: null,
            ...(expiresAt ? { expiresAt } : {}) },
        });
        await strapi.documents('api::test-run.test-run').update({
          documentId: testRun.documentId,
          data: { status: 'draft' },
        });
        return mapSessionStatusResponse(await getSessionByTestRun(runId));
      });
      ctx.body = { data };
    },

    async expiration(ctx) {
      const userId = ctx.state.user?.id;
      if (!userId) throw new errors.UnauthorizedError('Authentication is required.');
      const data = await strapi.db.transaction(async ({ trx }) => {
        const runId = String(ctx.params.documentId || '').trim();
        const { session } = await getManagedSession(trx, userId, runId);
        if (!session.activatedAt || !session.tokenHash ||
            !['active', 'completed', 'expired', 'revoked'].includes(session.status)) {
          throw new errors.ValidationError('Only published public UAT sessions have an editable expiration.');
        }
        const expiresAt = parseFutureExpiration(ctx.request.body?.data?.expiresAt);
        const resumeActive = session.status === 'expired' && !session.completionLocked &&
          !session.completedAt && !session.revokedAt;
        const restoreCompleted = session.status === 'expired' && Boolean(session.completedAt) && !session.revokedAt;
        await strapi.documents('api::public-uat-session.public-uat-session' as any).update({
          documentId: session.documentId,
          data: { expiresAt,
            ...(resumeActive ? { status: 'active' } : restoreCompleted ? { status: 'completed' } : {}) },
        });
        return mapSessionStatusResponse(await getSessionByTestRun(runId));
      });
      ctx.body = { data };
    },

    async status(ctx) {
      const testRunDocumentId = String(ctx.params.documentId || '').trim();
      if (!testRunDocumentId) {
        throw new errors.ValidationError('Test run is required.');
      }

      const testRun = await getTestRunForSession(testRunDocumentId);
      if (!testRun?.documentId || !testRun.organization?.documentId) {
        throw new errors.NotFoundError('Test run not found.');
      }

      const userId = ctx.state.user?.id;
      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      await ensureAdminAccessForOrganization(userId, testRun.organization.documentId);

      const session = await getSessionByTestRun(testRunDocumentId);
      ctx.body = {
        data: session?.documentId ? mapSessionStatusResponse(session) : null,
      };
    },

    async revoke(ctx) {
      const userId = ctx.state.user?.id;
      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const testRunDocumentId = String(ctx.params.documentId || '').trim();
      if (!testRunDocumentId) {
        throw new errors.ValidationError('Test run is required.');
      }

      const testRun = await getTestRunForSession(testRunDocumentId);
      if (!testRun?.documentId || !testRun.organization?.documentId) {
        throw new errors.NotFoundError('Test run not found.');
      }

      await ensureAdminAccessForOrganization(userId, testRun.organization.documentId);

      const session = await getSessionByTestRun(testRunDocumentId);
      if (!session?.documentId) {
        throw new errors.NotFoundError('Public UAT session not found.');
      }

      const updated = await strapi.documents('api::public-uat-session.public-uat-session' as any).update({
        documentId: session.documentId,
        data: {
          status: 'revoked',
          revokedAt: new Date().toISOString(),
          completionLocked: true,
        },
        populate: {
          organization: true,
          project: true,
          testRun: true,
          externalParticipant: true,
        },
      });

      ctx.body = {
        data: mapSessionStatusResponse(updated),
      };
    },

    async publicSession(ctx) {
      const token = String(ctx.params.token || '').trim();
      if (!token) {
        throw new errors.ValidationError('Public UAT token is required.');
      }

      const session = await validatePublicSessionToken(token);
      const refreshed = await strapi.documents('api::public-uat-session.public-uat-session' as any).update({
        documentId: session.documentId,
        data: {
          lastAccessedAt: new Date().toISOString(),
        },
        populate: {
          organization: true,
          project: true,
          testRun: {
            populate: {
              sprint: true,
              results: {
                sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
                populate: {
                  functionality: { populate: { module: { fields: ['name'] } } },
                  testCase: true,
                  bug: true,
                },
              },
            },
          },
          externalParticipant: true,
        },
      });

      ctx.body = {
        data: mapPublicSessionResponse(refreshed),
      };
    },

    async submitPublicResult(ctx) {
      const token = String(ctx.params.token || '').trim();
      const resultDocumentId = String(ctx.params.resultDocumentId || '').trim();

      if (!token || !resultDocumentId) {
        throw new errors.ValidationError('Public UAT token and result are required.');
      }

      const session = await validatePublicSessionToken(token);
      if (session.status !== 'active' || session.completionLocked) {
        throw new errors.ForbiddenError('This public UAT session is read-only.');
      }

      const payload = (ctx.request.body?.data || {}) as PublicResultPayload;
      const nextResult = payload.result;
      const nextNotes = payload.notes;
      const nextEvidenceImage = payload.evidenceImage;

      if (typeof nextResult !== 'undefined' && !session.allowResultEditing) {
        throw new errors.ForbiddenError('This public UAT session does not allow result editing.');
      }

      if (typeof nextNotes !== 'undefined' && !session.allowCommentEditing) {
        throw new errors.ForbiddenError('This public UAT session does not allow comment editing.');
      }

      if (typeof nextEvidenceImage !== 'undefined' && !session.allowEvidenceUpload) {
        throw new errors.ForbiddenError('This public UAT session does not allow evidence uploads.');
      }

      const existingResult = Array.isArray(session.testRun?.results)
        ? session.testRun.results.find((item: any) => item.documentId === resultDocumentId)
        : null;

      if (!existingResult?.documentId) {
        throw new errors.NotFoundError('Test run result not found for this public UAT session.');
      }

      const updated = await strapi.documents('api::test-run-result.test-run-result').update({
        documentId: existingResult.documentId,
        data: {
          ...(typeof nextResult !== 'undefined' ? { result: nextResult } : {}),
          ...(typeof nextNotes !== 'undefined' ? { notes: nextNotes || null } : {}),
          ...(typeof nextEvidenceImage !== 'undefined'
            ? { evidenceImage: nextEvidenceImage || null }
            : {}),
        } as any,
        populate: {
          functionality: { populate: { module: { fields: ['name'] } } },
          testCase: true,
          bug: true,
        },
      });

      ctx.body = {
        data: mapPublicResultItem(updated),
      };
    },

    async completePublicSession(ctx) {
      const token = String(ctx.params.token || '').trim();
      if (!token) {
        throw new errors.ValidationError('Public UAT token is required.');
      }

      // Locate the run, then revalidate token and lifecycle after both row locks.
      const initialSession = await validatePublicSessionToken(token);
      const data = await strapi.db.transaction(async ({ trx }) => {
        const { session: lockedSession } = await getLockedSession(trx, initialSession.testRun?.documentId);
        const session = await validatePublicSessionToken(token, lockedSession);
        if (session.status !== 'active' || session.completionLocked) {
          throw new errors.ForbiddenError('This public UAT session is already closed.');
        }

        if (hasPendingPublicResults(session)) {
          throw new errors.ValidationError(
            'All UAT test cases must have a saved result before completing the public session.',
          );
        }

        const nowIso = new Date().toISOString();
        const updatedSession = await strapi.documents('api::public-uat-session.public-uat-session' as any).update({
          documentId: session.documentId,
          data: {
            status: 'completed',
            completedAt: nowIso,
            completionLocked: true,
            lastAccessedAt: nowIso,
          },
          populate: {
            organization: true,
            project: true,
            testRun: {
              populate: {
                sprint: true,
                results: {
                  sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
                  populate: {
                    functionality: { populate: { module: { fields: ['name'] } } },
                    testCase: true,
                    bug: true,
                  },
                },
              },
            },
            externalParticipant: true,
          },
        });

        if (updatedSession.testRun?.documentId) {
          await strapi.documents('api::test-run.test-run').update({
            documentId: updatedSession.testRun.documentId,
            data: {
              status: 'final',
            } as any,
          });
        }

        return mapPublicSessionResponse(await getSessionByDocumentId(session.documentId));
      });
      ctx.body = { data };
    },
  }),
);
