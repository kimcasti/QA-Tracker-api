import nodemailer from 'nodemailer';

type InvitationEmailPayload = {
  invitationDocumentId: string;
  recipientEmail: string;
  organizationName: string;
  roleName: string;
  workspaceName?: string;
  workspaceLogoUrl?: string;
  inviterName?: string;
  inviterEmail?: string;
  invitationStatus?: 'new' | 'resent';
};

export type InvitationEmailHealth = {
  manualShareRecommended: boolean;
  summary?: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;

const DEFAULT_SMTP_TIMEOUT_MS = 15000;
const DEFAULT_MAILTRAP_API_URL = 'https://send.api.mailtrap.io/api/send';

function parseBoolean(value?: string) {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function normalizeUrl(value?: string) {
  return String(value || '').trim().replace(/\/$/, '');
}

function inferMailtrapApiToken(host?: string, user?: string, pass?: string) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  const normalizedUser = String(user || '').trim().toLowerCase();
  const normalizedPass = String(pass || '').trim();

  const isMailtrapHost =
    normalizedHost === 'live.smtp.mailtrap.io' || normalizedHost.endsWith('.mailtrap.io');
  const isMailtrapUser =
    normalizedUser === 'api' || normalizedUser === 'smtp@mailtrap.io';

  if (!isMailtrapHost || !isMailtrapUser || !normalizedPass) {
    return undefined;
  }

  return normalizedPass;
}

function getMailConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.MAIL_FROM?.trim();
  const mailtrapApiToken =
    process.env.MAILTRAP_API_TOKEN?.trim() || inferMailtrapApiToken(host, user, pass);
  const mailtrapApiUrl = normalizeUrl(process.env.MAILTRAP_API_URL || DEFAULT_MAILTRAP_API_URL);
  const publicApiUrl = normalizeUrl(process.env.PUBLIC_API_URL);
  const brandLogoUrl = normalizeUrl(
    process.env.MAIL_BRAND_LOGO_URL ||
      (publicApiUrl ? `${publicApiUrl}/branding/qa-tracker-logo.png` : ''),
  );
  const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || DEFAULT_SMTP_TIMEOUT_MS);
  const appUrl = normalizeUrl(
    process.env.INVITATION_APP_URL || process.env.APP_URL || 'http://localhost:3000',
  );

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    mailtrapApiToken,
    mailtrapApiTokenSource: process.env.MAILTRAP_API_TOKEN?.trim() ? 'env' : 'smtp-pass',
    mailtrapApiUrl,
    publicApiUrl,
    brandLogoUrl,
    timeoutMs,
    appUrl,
  };
}

function isPlaceholderMailFrom(value?: string) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('example.com') || normalized.includes('.local');
}

function isPlaceholderAppUrl(value?: string) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('replace_with_client_public_url');
}

export function buildInvitationAcceptanceUrl(invitationDocumentId: string) {
  const { appUrl } = getMailConfig();
  return `${appUrl}?${new URLSearchParams({
    invitation: invitationDocumentId,
    mode: 'signup',
  }).toString()}`;
}

export function getInvitationEmailHealth(): InvitationEmailHealth {
  const config = getMailConfig();
  const normalizedHost = String(config.host || '').trim().toLowerCase();

  if (!config.host && !config.mailtrapApiToken) {
    return {
      manualShareRecommended: true,
      summary:
        'El correo de invitaciones no esta configurado en este entorno. Completa SMTP o Mailtrap Sending en Railway.',
    };
  }

  if (normalizedHost === 'sandbox.smtp.mailtrap.io') {
    return {
      manualShareRecommended: true,
      summary:
        'Las invitaciones estan usando Mailtrap Sandbox. Ese modo no entrega correos a Gmail ni a bandejas reales.',
    };
  }

  if (isPlaceholderMailFrom(config.from)) {
    return {
      manualShareRecommended: true,
      summary:
        'MAIL_FROM sigue con un remitente placeholder. Usa un dominio verificado para mejorar la entrega.',
    };
  }

  if (isPlaceholderAppUrl(config.appUrl)) {
    return {
      manualShareRecommended: true,
      summary:
        'INVITATION_APP_URL aun apunta a un placeholder. Comparte el enlace manual mientras ajustas la URL final del cliente.',
    };
  }

  return {
    manualShareRecommended: false,
  };
}

function resetTransporter() {
  if (cachedTransporter) {
    cachedTransporter.close();
  }

  cachedTransporter = null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = getMailConfig();

  if (!config.host || !config.port || !config.from) {
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, MAIL_FROM, SMTP_USER and SMTP_PASS.',
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });

  return cachedTransporter;
}

function parseFromAddress(input: string) {
  const match = input.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);

  if (!match) {
    return {
      email: input.trim(),
    };
  }

  const displayName = match[1].trim().replace(/^"|"$/g, '');
  const email = match[2].trim();

  return {
    email,
    name: displayName || undefined,
  };
}

function buildInvitationEmail(payload: InvitationEmailPayload) {
  const config = getMailConfig();
  const subjectPrefix = payload.invitationStatus === 'resent' ? 'Invitacion reenviada' : 'Invitacion';
  const inviterLine = payload.inviterName || payload.inviterEmail;
  const actionCopy =
    payload.invitationStatus === 'resent'
      ? 'Tu invitacion fue reenviada. Usa el mismo correo para completar el acceso.'
      : 'Has sido invitado a colaborar en una organizacion de QA Tracker.';
  const workspaceName = payload.workspaceName?.trim();
  const workspaceLogoUrl = payload.workspaceLogoUrl?.trim();
  const brandLogoUrl = config.brandLogoUrl || '';
  const ctaUrl = buildInvitationAcceptanceUrl(payload.invitationDocumentId);
  const previewText = `${actionCopy} Organizacion: ${payload.organizationName}. Rol: ${payload.roleName}.`;

  const text = [
    subjectPrefix,
    '',
    actionCopy,
    '',
    `Organizacion: ${payload.organizationName}`,
    workspaceName ? `Workspace: ${workspaceName}` : '',
    `Rol sugerido: ${payload.roleName}`,
    inviterLine ? `Invitado por: ${inviterLine}` : '',
    '',
    `Aceptar invitacion: ${ctaUrl}`,
    '',
    'Si aun no tienes cuenta, registrate con este mismo correo para que la invitacion se acepte automaticamente.',
    'Si el boton no abre, copia y pega el enlace en tu navegador.',
  ]
    .filter(Boolean)
    .join('\n');

  const workspaceLogoBlock = workspaceLogoUrl
    ? `
        <td style="padding-left:16px;" align="right">
          <div style="display:inline-block;padding:10px;border:1px solid #dbe7f3;border-radius:18px;background:#ffffff;">
            <img src="${workspaceLogoUrl}" alt="${workspaceName || payload.organizationName}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:16px;object-fit:cover;" />
          </div>
        </td>
      `
    : '';

  const workspaceCard = workspaceName
    ? `
        <div style="margin:0 0 24px;padding:16px 18px;border:1px solid #dbe7f3;border-radius:20px;background:#f8fbff;">
          <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6b7f95;margin-bottom:8px;">
            Workspace
          </div>
          <div style="font-size:18px;line-height:26px;font-weight:700;color:#102a43;">
            ${workspaceName}
          </div>
        </div>
      `
    : '';

  const brandLogoBlock = brandLogoUrl
    ? `
        <td style="padding-right:16px;">
          <img src="${brandLogoUrl}" alt="QA Tracker" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:18px;object-fit:cover;box-shadow:0 12px 24px rgba(15,23,42,0.12);" />
        </td>
      `
    : '';

  return {
    from: config.from!,
    to: payload.recipientEmail,
    subject: `${subjectPrefix}: ${payload.organizationName}`,
    text,
    html: `
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        ${previewText}
      </div>
      <div style="margin:0;padding:32px 16px;background:#eef5fb;font-family:Arial,sans-serif;color:#102a43;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;">
                <tr>
                  <td style="padding-bottom:18px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:linear-gradient(135deg,#ffffff 0%,#f5fbff 100%);border:1px solid #dbe7f3;border-radius:28px;overflow:hidden;">
                      <tr>
                        <td style="padding:24px 28px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td valign="middle">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                  <tr>
                                    ${brandLogoBlock}
                                    <td valign="middle">
                                      <div style="font-size:24px;line-height:30px;font-weight:700;color:#102a43;">QA Tracker</div>
                                      <div style="font-size:13px;line-height:20px;color:#5d748b;">Invitacion a workspace</div>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                              ${workspaceLogoBlock}
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 28px 28px;">
                          <div style="padding:28px;border-radius:24px;background:#ffffff;border:1px solid #e5edf5;">
                            <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#6b7f95;margin-bottom:10px;">
                              ${subjectPrefix}
                            </div>
                            <div style="font-size:30px;line-height:38px;font-weight:700;color:#102a43;margin-bottom:12px;">
                              ${payload.organizationName}
                            </div>
                            <div style="font-size:16px;line-height:26px;color:#365069;margin-bottom:24px;">
                              ${actionCopy}
                            </div>
                            ${workspaceCard}
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;">
                              <tr>
                                <td style="padding:0 0 14px;">
                                  <div style="font-size:13px;line-height:20px;color:#6b7f95;">Organizacion</div>
                                  <div style="font-size:16px;line-height:24px;font-weight:700;color:#102a43;">${payload.organizationName}</div>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0 0 14px;">
                                  <div style="font-size:13px;line-height:20px;color:#6b7f95;">Rol sugerido</div>
                                  <div style="font-size:16px;line-height:24px;font-weight:700;color:#102a43;">${payload.roleName}</div>
                                </td>
                              </tr>
                              ${
                                inviterLine
                                  ? `
                                      <tr>
                                        <td style="padding:0;">
                                          <div style="font-size:13px;line-height:20px;color:#6b7f95;">Invitado por</div>
                                          <div style="font-size:16px;line-height:24px;font-weight:700;color:#102a43;">${inviterLine}</div>
                                        </td>
                                      </tr>
                                    `
                                  : ''
                              }
                            </table>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:22px;">
                              <tr>
                                <td align="center" bgcolor="#123f68" style="border-radius:14px;">
                                  <a href="${ctaUrl}" style="display:inline-block;padding:14px 22px;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">
                                    Aceptar invitacion
                                  </a>
                                </td>
                              </tr>
                            </table>
                            <div style="font-size:14px;line-height:22px;color:#5d748b;margin-bottom:10px;">
                              Si aun no tienes cuenta, registrate con este mismo correo para que la invitacion se acepte automaticamente.
                            </div>
                            <div style="font-size:12px;line-height:20px;color:#7b8ba1;word-break:break-word;">
                              Si el boton no abre, copia este enlace en tu navegador:<br />
                              <a href="${ctaUrl}" style="color:#123f68;text-decoration:underline;">${ctaUrl}</a>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
  };
}

async function sendWithMailtrapApi(
  payload: InvitationEmailPayload,
  message: ReturnType<typeof buildInvitationEmail>,
) {
  const config = getMailConfig();

  if (!config.mailtrapApiToken || !config.from) {
    throw new Error('Mailtrap API is not configured. Set MAILTRAP_API_TOKEN and MAIL_FROM.');
  }

  const from = parseFromAddress(config.from);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    console.info('[mail] Sending organization invitation email via Mailtrap API', {
      apiUrl: config.mailtrapApiUrl,
      from: config.from,
      to: payload.recipientEmail,
      timeoutMs: config.timeoutMs,
      tokenSource: config.mailtrapApiTokenSource,
    });

    const response = await fetch(config.mailtrapApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mailtrapApiToken}`,
        'Api-Token': config.mailtrapApiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [{ email: payload.recipientEmail }],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseBody = await response.text();

      throw new Error(
        `Mailtrap API request failed with status ${response.status}: ${responseBody || response.statusText}`,
      );
    }

    console.info('[mail] Invitation email sent successfully via Mailtrap API', {
      to: payload.recipientEmail,
      invitationDocumentId: payload.invitationDocumentId,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Mailtrap API send timed out after ${config.timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : String(error);

    console.error('[mail] Invitation email failed via Mailtrap API', {
      to: payload.recipientEmail,
      invitationDocumentId: payload.invitationDocumentId,
      error: message,
    });

    throw new Error(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendOrganizationInvitationEmail(payload: InvitationEmailPayload) {
  const config = getMailConfig();
  const message = buildInvitationEmail(payload);

  if (config.mailtrapApiToken) {
    await sendWithMailtrapApi(payload, message);
    return;
  }

  const transporter = getTransporter();

  try {
    console.info('[mail] Sending organization invitation email', {
      host: config.host,
      port: config.port,
      secure: config.secure,
      from: config.from,
      to: payload.recipientEmail,
      timeoutMs: config.timeoutMs,
    });

    await withTimeout(
      transporter.sendMail(message),
      config.timeoutMs,
      `SMTP send timed out after ${config.timeoutMs}ms.`,
    );

    console.info('[mail] Invitation email sent successfully', {
      to: payload.recipientEmail,
      invitationDocumentId: payload.invitationDocumentId,
    });
  } catch (error) {
    resetTransporter();
    console.error('[mail] Invitation email failed', {
      to: payload.recipientEmail,
      invitationDocumentId: payload.invitationDocumentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
