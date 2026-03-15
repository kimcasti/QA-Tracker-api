import nodemailer from 'nodemailer';

type InvitationEmailPayload = {
  recipientEmail: string;
  organizationName: string;
  roleName: string;
  inviterName?: string;
  inviterEmail?: string;
  invitationStatus?: 'new' | 'resent';
};

let cachedTransporter: nodemailer.Transporter | null = null;

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
    appUrl,
  };
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
      : 'Has sido invitado a colaborar en una organizacion de QA Tracker.';
  const ctaUrl = config.appUrl;

  return {
    from: config.from!,
    to: payload.recipientEmail,
    subject: `${subjectPrefix}: ${payload.organizationName}`,
    text: [
      actionCopy,
      `Organizacion: ${payload.organizationName}`,
      `Rol sugerido: ${payload.roleName}`,
      inviterLine ? `Invitado por: ${inviterLine}` : '',
      '',
      `Abre QA Tracker: ${ctaUrl}`,
      'Si aun no tienes cuenta, registrate con este mismo correo para que la invitacion se acepte automaticamente.',
    ]
      .filter(Boolean)
      .join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#102A43;">
        <h2 style="margin-bottom:8px;">${subjectPrefix}</h2>
        <p>${actionCopy}</p>
        <p><strong>Organizacion:</strong> ${payload.organizationName}</p>
        <p><strong>Rol sugerido:</strong> ${payload.roleName}</p>
        ${
          inviterLine
            ? `<p><strong>Invitado por:</strong> ${inviterLine}</p>`
            : ''
        }
        <p>
          <a href="${ctaUrl}" style="display:inline-block;background:#123F68;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;">
            Abrir QA Tracker
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
  const transporter = getTransporter();
  const message = buildInvitationEmail(payload);
  await transporter.sendMail(message);
}
