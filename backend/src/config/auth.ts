import dotenv from 'dotenv';

dotenv.config();

/**
 * Reads a required secret, or throws.
 *
 * These used to fall back to literals committed in this file. That failed
 * silently: an environment missing JWT_SECRET would sign tokens with a value
 * published in the repository, and anyone could forge an admin session. A
 * loud crash is the correct behaviour.
 */
const requireSecret = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Refusing to continue: tokens would be signed with a ` +
        `predictable secret, letting anyone forge an authenticated session.`
    );
  }
  return value;
};

export const authConfig = {
  // Getters, not values: the models import this module for saltRounds alone,
  // so scripts that only hash passwords (seed, demo:driver) must not be forced
  // to supply JWT secrets they never use.
  get jwtSecret(): string {
    return requireSecret('JWT_SECRET');
  },
  get jwtRefreshSecret(): string {
    return requireSecret('JWT_REFRESH_SECRET');
  },
  jwtExpiresIn: '1h',
  jwtRefreshExpiresIn: '7d',
  saltRounds: 10,
};

/**
 * Forces both secrets to be read at boot, so the server dies on startup rather
 * than on a user's first login attempt.
 */
export const assertAuthSecrets = (): void => {
  void authConfig.jwtSecret;
  void authConfig.jwtRefreshSecret;
};
