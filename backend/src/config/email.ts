import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, EMAIL_FROM } = process.env;

export const isEmailConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!isEmailConfigured) return null;
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

/**
 * Sends an email. Resolves to false rather than throwing when SMTP is not
 * configured or delivery fails, so callers can decide what to do without the
 * request failing. Never include secrets in the message: it is delivered in
 * plain text over the internet.
 */
export const sendMail = async ({ to, subject, text, html }: SendArgs): Promise<boolean> => {
  const tx = getTransporter();
  if (!tx) {
    console.warn(
      '[email] SMTP is not configured (needs SMTP_HOST, SMTP_USER, SMTP_PASS); skipping send to',
      to
    );
    return false;
  }

  try {
    await tx.sendMail({ from: fromAddress, to, subject, text, html });
    return true;
  } catch (error) {
    console.error('[email] Failed to send to', to, error);
    return false;
  }
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
