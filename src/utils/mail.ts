import nodemailer from 'nodemailer';

type InvitationEmailPayload = {
  invitationDocumentId: string;
  recipientEmail: string;
  organizationName: string;
  roleName: string;
  inviterName?: string;
  inviterEmail?: string;
  invitationStatus?: 'new' | 'resent';
};

let cachedTransporter: nodemailer.Transporter | null = null;

const DEFAULT_SMTP_TIMEOUT_MS = 15000;

function parseBoolean(value?: string) {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function getMailConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.MAIL_FROM?.trim();
  const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || DEFAULT_SMTP_TIMEOUT_MS);
  const appUrl = (process.env.INVITATION_APP_URL || process.env.APP_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/$/, '');

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    timeoutMs,
    appUrl,
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

function buildInvitationEmail(payload: InvitationEmailPayload) {
  const config = getMailConfig();
  const subjectPrefix = payload.invitationStatus === 'resent' ? 'Invitacion reenviada' : 'Invitacion';
  const inviterLine = payload.inviterName || payload.inviterEmail;
  const actionCopy =
    payload.invitationStatus === 'resent'
      ? 'Tu invitacion fue reenviada. Usa el mismo correo para completar el acceso.'
      : 'Has sido invitado a colaborar en una organización de QA Tracker.';
  const ctaUrl = `${config.appUrl}?${new URLSearchParams({
    invitation: payload.invitationDocumentId,
    mode: 'signup',
  }).toString()}`;

  return {
    from: config.from!,
    to: payload.recipientEmail,
    subject: `${subjectPrefix}: ${payload.organizationName}`,
    text: [
      actionCopy,
      `Organización: ${payload.organizationName}`,
      `Rol sugerido: ${payload.roleName}`,
      inviterLine ? `Invitado por: ${inviterLine}` : '',
      '',
      `Acepta la invitacion en QA Tracker: ${ctaUrl}`,
      'Si aun no tienes cuenta, registrate con este mismo correo para que la invitacion se acepte automaticamente.',
    ]
      .filter(Boolean)
      .join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#102A43;">
        <h2 style="margin-bottom:8px;">${subjectPrefix}</h2>
        <p>${actionCopy}</p>
        <p><strong>Organización:</strong> ${payload.organizationName}</p>
        <p><strong>Rol sugerido:</strong> ${payload.roleName}</p>
        ${
          inviterLine
            ? `<p><strong>Invitado por:</strong> ${inviterLine}</p>`
            : ''
        }
        <p>
          <a href="${ctaUrl}" style="display:inline-block;background:#123F68;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;">
            Aceptar invitacion
          </a>
        </p>
        <p style="color:#5D748B;">
          Si aun no tienes cuenta, registrate con este mismo correo para que la invitacion se acepte automaticamente.
        </p>
      </div>
    `,
  };
}

export async function sendOrganizationInvitationEmail(payload: InvitationEmailPayload) {
  const config = getMailConfig();
  const transporter = getTransporter();
  const message = buildInvitationEmail(payload);

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
