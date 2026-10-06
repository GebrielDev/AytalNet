import { describe, it, expect } from 'vitest';
import { isValidEmail, parseAdminArgs } from './adminArgs';

const parse = (argv: string[], env: NodeJS.ProcessEnv = {}) => parseAdminArgs(argv, env);

describe('createAdmin arguments', () => {
  it('reads name and email from flags, in either form', () => {
    for (const argv of [
      ['--name', 'Gebriel Dawit', '--email', 'gebriel@gmail.com'],
      ['--name=Gebriel Dawit', '--email=gebriel@gmail.com'],
    ]) {
      expect(parse(argv).args).toEqual({
        name: 'Gebriel Dawit',
        email: 'gebriel@gmail.com',
        role: 'admin',
      });
    }
  });

  it('falls back to the environment', () => {
    expect(parse([], { ADMIN_NAME: 'Someone', ADMIN_EMAIL: 'someone@example.com' }).args).toEqual({
      name: 'Someone',
      email: 'someone@example.com',
      role: 'admin',
    });
  });

  it('prefers a flag over the environment', () => {
    const env = { ADMIN_EMAIL: 'env@example.com', ADMIN_NAME: 'Env' };
    expect(parse(['--email=flag@example.com', '--name=Flag'], env).args?.email).toBe(
      'flag@example.com'
    );
  });

  // Addresses are compared case-sensitively by the login lookup, so an account
  // created as Gebriel@... would reject the gebriel@... someone types.
  it('lowercases the address', () => {
    expect(parse(['--name=A', '--email=Gebriel@Gmail.COM']).args?.email).toBe('gebriel@gmail.com');
  });

  it('trims surrounding whitespace', () => {
    const { args } = parse(['--name=  Gebriel Dawit  ', '--email=  gebriel@gmail.com  ']);
    expect(args).toEqual({ name: 'Gebriel Dawit', email: 'gebriel@gmail.com', role: 'admin' });
  });

  it('defaults to admin but accepts dispatcher', () => {
    expect(parse(['--name=A', '--email=a@b.co']).args?.role).toBe('admin');
    expect(parse(['--name=A', '--email=a@b.co', '--role=dispatcher']).args?.role).toBe('dispatcher');
  });

  it('refuses a role the model would reject', () => {
    const { args, errors } = parse(['--name=A', '--email=a@b.co', '--role=superuser']);
    expect(args).toBeUndefined();
    expect(errors.join(' ')).toMatch(/Role must be one of/);
  });

  it('reports everything missing at once', () => {
    expect(parse([]).errors).toHaveLength(2);
  });

  it('rejects an address the login form would not accept', () => {
    for (const email of ['nope', 'no@domain', 'two@@at.com', 'spaces in@example.com', '@example.com']) {
      expect(isValidEmail(email), email).toBe(false);
    }
    for (const email of ['a@b.co', 'first.last@sub.example.com', 'gebriel@gmail.com']) {
      expect(isValidEmail(email), email).toBe(true);
    }
  });
});
