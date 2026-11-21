import crypto from 'node:crypto';
import { QueryTypes } from 'sequelize';
import type { Request, Response, NextFunction } from 'express';
import sequelize from '../config/database';

/**
 * Slows down password guessing on login / forgot / reset. Counts live in
 * Postgres (auth_rate_limits) so every server instance shares them.
 *
 * Two fixed 15-minute windows per request:
 *  - this IP + this email: 10 tries (stops guessing one account)
 *  - this IP, any email: 50 tries (stops spraying many accounts)
 * Successful logins are taken back off, so a depot full of drivers signing
 * in on one Wi-Fi isn't locked out - only failures add up.
 */
const WINDOW_MS = 15 * 60_000;
const PER_ACCOUNT = Number(process.env.AUTH_RATE_LIMIT_PER_ACCOUNT) || 10;
const PER_IP = Number(process.env.AUTH_RATE_LIMIT_PER_IP) || 50;

const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const hit = async (key: string, start: Date): Promise<number> => {
  const rows = await sequelize.query<{ hits: number }>(
    `INSERT INTO auth_rate_limits (key, window_start, hits) VALUES (:key, :start, 1)
     ON CONFLICT (key) DO UPDATE
       SET hits = CASE WHEN auth_rate_limits.window_start = :start THEN auth_rate_limits.hits + 1 ELSE 1 END,
           window_start = :start
     RETURNING hits`,
    { replacements: { key, start }, type: QueryTypes.SELECT }
  );
  return Number(rows[0]?.hits ?? 0);
};

let lastCleanup = 0;

export const authRateLimit = (kind: 'login' | 'driver-login' | 'forgot' | 'reset') =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const now = Date.now();
      const start = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
      const ip = req.ip || 'unknown';
      const who = String(req.body?.email ?? req.body?.token ?? '').trim().toLowerCase();
      const keys = [`${kind}:${digest(`${ip}|${who}`)}`, `${kind}:ip:${digest(ip)}`];
      const [account, total] = await Promise.all(keys.map((k) => hit(k, start)));
      const retryAfter = Math.ceil((start.getTime() + WINDOW_MS - now) / 1000);
      if (account > PER_ACCOUNT || total > PER_IP) {
        res.setHeader('Retry-After', String(retryAfter));
        const minutes = Math.max(1, Math.ceil(retryAfter / 60));
        res.status(429).json({ error: `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.` });
        return;
      }
      // Occasionally drop old windows so the table stays small.
      if (now - lastCleanup > WINDOW_MS) {
        lastCleanup = now;
        sequelize.query('DELETE FROM auth_rate_limits WHERE window_start < :cutoff', { replacements: { cutoff: new Date(now - 2 * WINDOW_MS) } }).catch(() => {});
      }
      if (kind === 'login' || kind === 'driver-login') {
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          sequelize
            .query('UPDATE auth_rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key IN (:keys) AND window_start = :start', { replacements: { keys, start } })
            .catch(() => {});
        });
      }
      next();
    } catch (error) {
      // Never lock everyone out because the counter failed.
      console.error('[auth] Rate limit check failed', error);
      next();
    }
  };
