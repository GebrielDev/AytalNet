/**
 * Argument handling for createAdmin, kept separate so it can be tested without
 * a database.
 */

export interface AdminArgs {
  name: string;
  email: string;
  role: 'admin' | 'dispatcher';
}

export const ROLES = ['admin', 'dispatcher'] as const;

const flag = (argv: string[], name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }
  return undefined;
};

/**
 * An address this script would accept but the login form would not is worse
 * than a rejection here: the account exists and nobody can sign in to it. This
 * is deliberately strict rather than RFC-complete - one @, no spaces, a dot in
 * the domain.
 */
export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);

/**
 * Reads name, email and role from the command line, falling back to the
 * environment. Returns the problems rather than throwing, so the script can
 * print all of them at once.
 */
export const parseAdminArgs = (
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): { args?: AdminArgs; errors: string[] } => {
  const name = (flag(argv, 'name') ?? env.ADMIN_NAME ?? '').trim();
  const email = (flag(argv, 'email') ?? env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const role = (flag(argv, 'role') ?? env.ADMIN_ROLE ?? 'admin').trim();

  const errors: string[] = [];
  if (!name) errors.push('A name is required: --name "Given Family" or ADMIN_NAME.');
  if (!email) errors.push('An email is required: --email someone@example.com or ADMIN_EMAIL.');
  else if (!isValidEmail(email)) errors.push(`Not a usable email address: ${email}`);
  if (!ROLES.includes(role as AdminArgs['role'])) {
    errors.push(`Role must be one of ${ROLES.join(', ')}, not ${role}.`);
  }

  if (errors.length > 0) return { errors };
  return { args: { name, email, role: role as AdminArgs['role'] }, errors };
};
