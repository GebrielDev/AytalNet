import sequelize from '../config/database';
import { User } from '../models';
import { parseAdminArgs } from './adminArgs';
import { resolvePassword } from './seedCredentials';

/**
 * Creates one real administrator (or dispatcher) account.
 *
 * The seed is not the tool for this: it writes demo drivers, vehicles and
 * trips, and refuses to run against production for that reason. This writes
 * exactly one row in `users` and nothing else, so it is safe to point at a
 * live database.
 *
 *   npm run admin:create -- --name "Given Family" --email someone@example.com
 *   npm run admin:create -- --name "..." --email "..." --role dispatcher
 *
 * The password comes from ADMIN_PASSWORD, or is generated and printed once.
 * Only the hash is stored, so a password that is not written down has to be
 * reset through the forgot-password flow.
 *
 * Idempotent, and deliberately inert on an account that already exists: it
 * reports what is there and changes nothing, rather than silently resetting a
 * working password or quietly granting admin to an existing dispatcher.
 */
const run = async (): Promise<void> => {
  const { args, errors } = parseAdminArgs(process.argv.slice(2));
  if (!args) {
    errors.forEach((error) => console.error(error));
    process.exitCode = 1;
    return;
  }

  await sequelize.authenticate();

  const existing = await User.findOne({ where: { email: args.email } });
  if (existing) {
    console.log(
      `${existing.email} already exists (id ${existing.id}, role ${existing.role}, name "${existing.name}").`
    );
    console.log('Nothing was changed. Use the forgot-password flow to reset its password,');
    console.log('or the admin user management screen to change its name or role.');
    return;
  }

  const password = resolvePassword('ADMIN_PASSWORD');
  // passwordHash is hashed by the model's beforeCreate hook.
  const user = await User.create({
    email: args.email,
    name: args.name,
    passwordHash: password.value,
    role: args.role,
  });

  console.log(`Created ${user.role} ${user.email} (id ${user.id}, name "${user.name}").`);
  if (password.fromEnv) {
    console.log('Password: the one supplied in ADMIN_PASSWORD.');
  } else {
    console.log('');
    console.log(`  Password: ${password.value}`);
    console.log('');
    console.log('Generated for this run - this is the only time it is shown, as only the');
    console.log('hash is stored. Save it now.');
  }
};

run()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error('Failed to create the account:', error instanceof Error ? error.message : error);
    await sequelize.close().catch(() => undefined);
    process.exit(1);
  });
