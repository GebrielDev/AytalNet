import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const findByPkUser = vi.fn();
const findByPkDriver = vi.fn();

vi.mock('../models', () => ({
  User: { findByPk: (...a: unknown[]) => findByPkUser(...a) },
  Driver: { findByPk: (...a: unknown[]) => findByPkDriver(...a) },
}));

const SECRET = 'test-secret';
vi.mock('../config/auth', () => ({
  authConfig: { get jwtSecret() { return 'test-secret'; }, saltRounds: 10 },
}));

const buildApp = async () => {
  const { authenticateToken, requireUser } = await import('./auth');
  const app = express();
  app.get('/protected', authenticateToken, (_req, res) => res.json({ ok: true }));
  app.get('/user-only', authenticateToken, requireUser, (_req, res) => res.json({ ok: true }));
  return app;
};

const get = async (path: string, token?: string) => {
  const app = await buildApp();
  const req = request(app).get(path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('authenticateToken', () => {
  beforeEach(() => {
    findByPkUser.mockReset();
    findByPkDriver.mockReset();
  });

  it('allows a valid user token', async () => {
    findByPkUser.mockResolvedValue({ id: 1 });
    const token = jwt.sign({ id: 1, email: 'a@b.c', type: 'user' }, SECRET, { expiresIn: '1h' });

    expect((await get('/protected', token)).status).toBe(200);
  });

  // The whole point of the refresh interceptors: they fire on 401. This used
  // to be 403, so the one-hour expiry - the case the refresh flow exists for -
  // never triggered it, and a dispatcher was logged out while a driver could
  // not end a trip that had run over an hour.
  it('answers 401 for an EXPIRED token, which is what triggers a client refresh', async () => {
    const token = jwt.sign({ id: 1, email: 'a@b.c', type: 'user' }, SECRET, { expiresIn: '-1s' });
    const res = await get('/protected', token);

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('answers 401 for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ id: 1, email: 'a@b.c', type: 'user' }, 'not-the-secret');
    expect((await get('/protected', token)).status).toBe(401);
  });

  it('answers 401 for a malformed token', async () => {
    expect((await get('/protected', 'not-a-jwt')).status).toBe(401);
  });

  it('answers 401 when no token is sent', async () => {
    expect((await get('/protected')).status).toBe(401);
  });

  it('answers 401 when the user record is gone', async () => {
    findByPkUser.mockResolvedValue(null);
    const token = jwt.sign({ id: 1, email: 'a@b.c', type: 'user' }, SECRET, { expiresIn: '1h' });

    expect((await get('/protected', token)).status).toBe(401);
  });

  it('answers 401 for an inactive driver', async () => {
    findByPkDriver.mockResolvedValue({ id: 2, status: 'inactive' });
    const token = jwt.sign({ id: 2, email: 'd@b.c', type: 'driver' }, SECRET, { expiresIn: '1h' });

    expect((await get('/protected', token)).status).toBe(401);
  });

  // 403 still means what it should: authenticated, but not allowed. Refreshing
  // a token cannot change this, which is why it must stay distinct from 401.
  it('answers 403 when an authenticated driver hits a user-only route', async () => {
    findByPkDriver.mockResolvedValue({ id: 2, status: 'active' });
    const token = jwt.sign({ id: 2, email: 'd@b.c', type: 'driver' }, SECRET, { expiresIn: '1h' });

    expect((await get('/user-only', token)).status).toBe(403);
  });
});
