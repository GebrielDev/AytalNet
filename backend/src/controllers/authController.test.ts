import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The models talk to Postgres, which CI has no access to. Every query used by
// the login paths is stubbed, so these tests exercise the controller's own
// logic and nothing else.
const findOneUser = vi.fn();
const findOneDriver = vi.fn();
const findByPkUser = vi.fn();
const findByPkDriver = vi.fn();

/**
 * Sequelize validates `where` values before it ever opens a connection, and
 * rejects anything that is not a plain scalar:
 *
 *   { email: undefined }      Error: WHERE parameter "email" has invalid "undefined" value
 *   { email: { a: 'b' } }     Error: Invalid value { a: 'b' }
 *
 * The stub reproduces that, because it is the whole point of these tests: a
 * controller that passes an unchecked req.body field straight into findOne
 * turns a malformed request into a 500.
 */
const sequelizeLikeFindOne = (spy: ReturnType<typeof vi.fn>) =>
  (options: { where?: Record<string, unknown> }) => {
    for (const [key, value] of Object.entries(options?.where ?? {})) {
      if (value === undefined) {
        throw new Error(`WHERE parameter "${key}" has invalid "undefined" value`);
      }
      if (value !== null && typeof value === 'object') {
        throw new Error(`Invalid value ${JSON.stringify(value)}`);
      }
    }
    return spy(options);
  };

vi.mock('../models', () => ({
  User: {
    findOne: (o: never) => sequelizeLikeFindOne(findOneUser)(o),
    findByPk: (...a: unknown[]) => findByPkUser(...a),
  },
  Driver: {
    findOne: (o: never) => sequelizeLikeFindOne(findOneDriver)(o),
    findByPk: (...a: unknown[]) => findByPkDriver(...a),
  },
  PasswordResetToken: {
    cleanExpired: vi.fn(),
    createToken: vi.fn().mockResolvedValue('tok'),
    findValidToken: vi.fn(),
  },
}));

vi.mock('../config/email', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  emailProvider: 'resend',
}));

vi.mock('../middleware/auth', () => ({
  generateAccessToken: () => 'access',
  generateRefreshToken: () => 'refresh',
  verifyRefreshToken: (t: string) => {
    if (t === 'good') return { id: 1, email: 'a@b.c', type: 'user' };
    if (t === 'good-driver') return { id: 1, email: 'd@b.c', type: 'driver' };
    return null;
  },
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const buildApp = async () => {
  const { default: authRoutes } = await import('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
};

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    findOneUser.mockReset();
    findOneDriver.mockReset();
  });

  // Sequelize rejects `where: { email: undefined }`, so an empty body used to
  // reach the database and come back as a 500 - a client mistake reported as a
  // server fault, and noise in any error budget built on 5xx rates.
  it('rejects an empty body with 400 and never reaches the database', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(findOneUser).not.toHaveBeenCalled();
  });

  it('rejects a missing password with 400', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c' });

    expect(res.status).toBe(400);
    expect(findOneUser).not.toHaveBeenCalled();
  });

  // A JSON body of `{"email": {"$ne": null}}` reaches Sequelize as an object.
  // Requiring a string keeps operator-shaped input out of the query builder.
  it('rejects a non-string email with 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { nested: 'object' }, password: 'x' });

    expect(res.status).toBe(400);
    expect(findOneUser).not.toHaveBeenCalled();
  });

  it('still answers 401 for a wrong password, not 400', async () => {
    findOneUser.mockResolvedValue({ validatePassword: async () => false });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.c', password: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('returns tokens for valid credentials', async () => {
    findOneUser.mockResolvedValue({
      id: 1, email: 'a@b.c', name: 'A', role: 'admin',
      validatePassword: async () => true,
    });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.c', password: 'right' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access');
    expect(res.body.refreshToken).toBe('refresh');
  });

  // The 500 handler used to return String(error), putting Sequelize's message -
  // table and column names, sometimes the failing SQL - in an unauthenticated
  // response.
  it('does not leak internals when the query throws', async () => {
    findOneUser.mockRejectedValue(new Error('relation "users" does not exist'));
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.c', password: 'x' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });
});

describe('POST /api/auth/driver/login', () => {
  beforeEach(() => findOneDriver.mockReset());

  it('rejects an empty body with 400 and never reaches the database', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/auth/driver/login').send({});

    expect(res.status).toBe(400);
    expect(findOneDriver).not.toHaveBeenCalled();
  });

  it('answers 401 for an inactive driver', async () => {
    findOneDriver.mockResolvedValue({ status: 'inactive', validatePassword: async () => true });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/driver/login')
      .send({ email: 'd@b.c', password: 'x' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    findByPkUser.mockReset();
    findByPkDriver.mockReset();
    findByPkUser.mockResolvedValue({ id: 1 });
    findByPkDriver.mockResolvedValue({ id: 1, status: 'active' });
  });

  it('rejects an empty body with 400', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/auth/refresh').send({});

    expect(res.status).toBe(400);
  });

  it('rejects an unparseable token with 401', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'bad' });

    expect(res.status).toBe(401);
  });

  it('issues a new pair for a valid refresh token', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'good' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access');
  });

  // A refresh token lives for seven days. Checking only its signature let a
  // closed account keep minting hour-long access tokens for a week - the one
  // auth path that did not re-check the account, while authenticateToken and
  // the socket handshake both did.
  it('refuses to refresh for a user whose account is gone', async () => {
    findByPkUser.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'good' });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('refuses to refresh for a driver who has been deactivated', async () => {
    findByPkDriver.mockResolvedValue({ id: 1, status: 'inactive' });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'good-driver' });

    expect(res.status).toBe(401);
  });

  it('still refreshes for an active driver', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'good-driver' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access');
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('rejects an empty body with 400 and never reaches the database', async () => {
    findOneUser.mockReset();
    const app = await buildApp();
    const res = await request(app).post('/api/auth/forgot-password').send({});

    expect(res.status).toBe(400);
    expect(findOneUser).not.toHaveBeenCalled();
  });
});
