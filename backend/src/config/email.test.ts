import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a: unknown[]) => sendMailMock(...a) }) },
}));
// The real one reads a developer's .env, which would decide these tests for them.
vi.mock('dotenv', () => ({ default: { config: () => undefined } }));

/**
 * The module reads its configuration once, at import, so each case imports it
 * fresh with the environment it is about.
 */
const loadWith = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const key of ['RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_SECURE', 'EMAIL_FROM']) {
    delete process.env[key];
  }
  Object.entries(env).forEach(([k, v]) => {
    if (v !== undefined) process.env[k] = v;
  });
  return import('./email');
};

const SMTP = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' };
const MAIL = { to: 'driver@example.com', subject: 'Reset', text: 'plain', html: '<p>html</p>' };

const okResponse = () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '{"id":"1"}' });

describe('email provider selection', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    sendMailMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses Resend when its key is set', async () => {
    const { emailProvider } = await loadWith({ RESEND_API_KEY: 'key' });
    expect(emailProvider).toBe('resend');
  });

  it('falls back to SMTP when there is no Resend key', async () => {
    const { emailProvider } = await loadWith(SMTP);
    expect(emailProvider).toBe('smtp');
  });

  // Resend wins deliberately: the SMTP credentials in production are a
  // Microsoft 365 account whose tenant refuses client submission (535 5.7.139).
  it('prefers Resend when both are configured', async () => {
    const { emailProvider } = await loadWith({ ...SMTP, RESEND_API_KEY: 'key' });
    expect(emailProvider).toBe('resend');
  });

  it('reports nothing configured when neither is set', async () => {
    const { emailProvider } = await loadWith({});
    expect(emailProvider).toBeNull();
  });

  it('partial SMTP settings do not count as configured', async () => {
    const { emailProvider } = await loadWith({ SMTP_HOST: 'smtp.example.com' });
    expect(emailProvider).toBeNull();
  });
});

describe('sending through Resend', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts the message to the Resend API and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const { sendMail, fromAddress } = await loadWith({
      RESEND_API_KEY: 'test-key',
      EMAIL_FROM: 'STS Fleet <noreply@startechsolutions.us>',
    });

    expect(await sendMail(MAIL)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      from: fromAddress,
      to: ['driver@example.com'],
      subject: 'Reset',
      text: 'plain',
      html: '<p>html</p>',
    });
    // A provider that hangs must not hold the request open forever.
    expect(init.signal).toBeDefined();
  });

  // The usual cause is a sending domain that has not been verified, and the
  // body is the only place that says so.
  it('returns false and logs the reason when Resend rejects it', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args));
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      text: async () => '{"message":"The domain is not verified"}',
    }) as unknown as typeof fetch;

    const { sendMail } = await loadWith({ RESEND_API_KEY: 'test-key' });

    expect(await sendMail(MAIL)).toBe(false);
    const logged = errors.flat().join(' ');
    expect(logged).toMatch(/403/);
    expect(logged).toMatch(/domain is not verified/);
  });

  it('returns false rather than throwing when the request itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const { sendMail } = await loadWith({ RESEND_API_KEY: 'test-key' });

    expect(await sendMail(MAIL)).toBe(false);
  });

  it('never puts the API key in the log', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args));
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized', text: async () => '{"message":"bad key"}',
    }) as unknown as typeof fetch;

    const { sendMail } = await loadWith({ RESEND_API_KEY: 'super-secret-key' });
    await sendMail(MAIL);

    expect(errors.flat().join(' ')).not.toContain('super-secret-key');
  });

  it('sends the reset email with its link through Resend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const { sendPasswordResetEmail } = await loadWith({ RESEND_API_KEY: 'test-key' });
    const link = 'https://dash.example.com/reset-password?token=abc123';

    expect(await sendPasswordResetEmail('driver@example.com', link)).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toMatch(/reset/i);
    expect(body.text).toContain(link);
    expect(body.html).toContain(link);
  });
});

describe('with no provider configured', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves false and sends nothing', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { sendMail } = await loadWith({});

    expect(await sendMail(MAIL)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('sending through SMTP', () => {
  beforeEach(() => {
    sendMailMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('still works when it is the only provider', async () => {
    const { sendMail } = await loadWith(SMTP);

    expect(await sendMail(MAIL)).toBe(true);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: MAIL.to, subject: MAIL.subject }));
  });

  it('returns false when the transport throws', async () => {
    sendMailMock.mockRejectedValue(new Error('535 5.7.139 Authentication unsuccessful'));
    const { sendMail } = await loadWith(SMTP);

    expect(await sendMail(MAIL)).toBe(false);
  });
});
