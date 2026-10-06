import crypto from 'crypto';

/**
 * Passwords for the seeded demo accounts.
 *
 * These used to be literals in seed.ts - admin@fleet.com / admin123 and
 * friends - which meant the credentials for an administrator account lived in
 * source control. Anywhere the seed had ever been run, those accounts existed
 * with a password anyone reading the repository already knew.
 *
 * A password is now either supplied through the environment (so a deliberate
 * setup can choose one) or generated per run and printed once.
 */

// No ambiguous glyphs: these get read off a terminal and typed into a phone.
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const randomPassword = (length = 20): string => {
  // rejection-free: 256 is not a multiple of 56, so a plain modulo would bias
  // the early letters. Drawing from a larger pool and discarding the tail of
  // the byte range keeps every symbol equally likely.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
};

export interface SeedPassword {
  value: string;
  fromEnv: boolean;
}

export const resolvePassword = (
  envVar: string,
  env: NodeJS.ProcessEnv = process.env
): SeedPassword => {
  const supplied = env[envVar];
  if (typeof supplied === 'string' && supplied.length > 0) {
    return { value: supplied, fromEnv: true };
  }
  return { value: randomPassword(), fromEnv: false };
};

/**
 * The seed writes demo drivers, vehicles and trips. That is not data anyone
 * wants appearing in a live fleet, and the accounts it creates are meant for
 * development, so running it against production has to be deliberate.
 */
export const productionSeedBlocked = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === 'production' && env.ALLOW_PRODUCTION_SEED !== 'yes';
