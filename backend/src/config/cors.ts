import dotenv from 'dotenv';

dotenv.config();

/**
 * Which browser origins may call this API.
 *
 * This used to be `origin: true`, which reflects whatever Origin the request
 * carries - that is, every website. The comment beside it said "development",
 * but it shipped to production.
 *
 * The project's own hosts are listed as defaults so that a missing or mistyped
 * FRONTEND_URL cannot quietly reopen the API to everyone; the environment can
 * add to the list but an empty environment still yields a working, closed one.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://dashboard.startechsolutions.us',
  'https://driverapp.startechsolutions.us',
];

// 5180 is what web-dashboard/vite.config.ts actually binds, with
// strictPort: true so it does not fall back. 5173 is Vite's default and is
// kept for anyone running it unconfigured.
const DEV_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5173',
  'http://localhost:3000',
];

const normalise = (origin: string): string => origin.trim().replace(/\/+$/, '');

export const buildAllowedOrigins = (env: NodeJS.ProcessEnv = process.env): string[] =>
  Array.from(
    new Set(
      [
        ...DEFAULT_ALLOWED_ORIGINS,
        env.FRONTEND_URL || '',
        ...(env.CORS_ORIGINS || '').split(','),
        ...(env.NODE_ENV === 'production' ? [] : DEV_ORIGINS),
      ]
        .map(normalise)
        .filter(Boolean)
    )
  );

export const allowedOrigins = buildAllowedOrigins();

/**
 * Only browsers send an Origin header. The driver app is native and sends
 * none, as do server-to-server callers and curl, so a missing Origin is
 * allowed - CORS is not what protects those paths; the bearer token is.
 */
export const isOriginAllowed = (
  origin: string | undefined,
  origins: string[] = allowedOrigins
): boolean => !origin || origins.includes(normalise(origin));
