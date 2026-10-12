import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const {
  RESEND_API_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  EMAIL_FROM,
} = process.env;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
// A password reset is sent inside a request the user is waiting on, so a
// provider that hangs must not hold the handler open indefinitely.
const SEND_TIMEOUT_MS = 10_000;

export type EmailProvider = 'resend' | 'smtp';

/**
 * Which transport sends the mail, or null when none is configured.
 *
 * Resend wins when both are set, because SMTP here did not work: Microsoft 365
 * refuses client submission at the tenant level, so every send failed with
 *
 *   535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is
 *   disabled for the Tenant
 *
 * and password reset was dead for dispatchers and drivers alike. Resend is
 * reached over HTTPS, which also cannot be blocked by the host's plan tier or
 * by port filtering the way SMTP can - Railway disables outbound SMTP below
 * the Pro plan and recommends a transactional API for every plan.
 *
 * SMTP is kept rather than deleted so an environment that has working
 * credentials keeps working, and so this can be switched back by unsetting one
 * variable.
 */
export const emailProvider: EmailProvider | null = RESEND_API_KEY
  ? 'resend'
  : SMTP_HOST && SMTP_USER && SMTP_PASS
  ? 'smtp'
  : null;


let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (emailProvider !== 'smtp') return null;
  if (!transporter) {
    const port = Number(SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      // Implicit TLS on 465; STARTTLS on 587 and friends.
      secure: SMTP_SECURE ? SMTP_SECURE === 'true' : port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
};

export const fromAddress = EMAIL_FROM || 'StarTech Solutions <admin@startechsolutions.us>';

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const sendViaResend = async ({ to, subject, text, html }: SendArgs): Promise<boolean> => {
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries the actual reason - an unverified sending domain, a
      // malformed from address - which is the difference between a fixable
      // configuration error and a mystery. It never contains the API key.
      const detail = await response.text().catch(() => '');
      console.error(
        `[email] Resend rejected the send to ${to}: ${response.status} ${response.statusText}`,
        detail.slice(0, 500)
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error('[email] Resend request to', to, 'failed', error);
    return false;
  }
};

const sendViaSmtp = async ({ to, subject, text, html }: SendArgs): Promise<boolean> => {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    await tx.sendMail({ from: fromAddress, to, subject, text, html });
    return true;
  } catch (error) {
    console.error('[email] Failed to send to', to, error);
    return false;
  }
};

/**
 * Sends an email. Resolves to false rather than throwing when no provider is
 * configured or delivery fails, so callers can decide what to do without the
 * request failing. Never include secrets in the message: it is delivered in
 * plain text over the internet.
 */
export const sendMail = async (args: SendArgs): Promise<boolean> => {
  if (emailProvider === 'resend') return sendViaResend(args);
  if (emailProvider === 'smtp') return sendViaSmtp(args);

  console.warn(
    '[email] No email provider is configured (set RESEND_API_KEY, or ' +
      'SMTP_HOST/SMTP_USER/SMTP_PASS); skipping send to',
    args.to
  );
  return false;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const sendPasswordResetEmail = async (to: string, resetLink: string): Promise<boolean> => {
  const safeLink = escapeHtml(resetLink);

  const text = [
    'We received a request to reset the password for your STS Fleet account.',
    '',
    'Open this link to choose a new password:',
    resetLink,
    '',
    'The link expires in one hour and can only be used once.',
    "If you did not request this, you can ignore this email; your password will not change.",
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:20px;">Reset your password</h1>
    <p style="margin:0 0 16px;line-height:1.6;color:#334155;">
      We received a request to reset the password for your STS Fleet account.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${safeLink}"
         style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">
        Choose a new password
      </a>
    </p>
    <p style="margin:0 0 16px;line-height:1.6;color:#64748b;font-size:14px;">
      The link expires in one hour and can only be used once. If the button does not work,
      copy this address into your browser:<br />
      <span style="word-break:break-all;">${safeLink}</span>
    </p>
    <p style="margin:0;line-height:1.6;color:#64748b;font-size:14px;">
      If you did not request this, you can ignore this email — your password will not change.
    </p>
  </div>
</body>
</html>`;

  return sendMail({ to, subject: 'Reset your STS Fleet password', text, html });
};
