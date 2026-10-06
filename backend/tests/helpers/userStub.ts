import { User } from '../../src/models';

type FindByPk = typeof User.findByPk;

/**
 * Replaces User.findByPk with an in-memory set of ids, so the socket handshake
 * and the user controller can be exercised without a database.
 *
 * The rows it hands back expose `destroy`, mirroring what deleteUser calls on
 * the row it fetched: removing the id makes subsequent lookups fail, which is
 * what a real delete does.
 */
export const stubUsers = (ids: number[]) => {
  const original = User.findByPk;
  const existing = new Set(ids);

  (User as unknown as { findByPk: unknown }).findByPk = async (id: unknown) => {
    const numeric = Number(id);
    if (!existing.has(numeric)) return null;
    return {
      id: numeric,
      destroy: async () => {
        existing.delete(numeric);
      },
    };
  };

  return {
    existing,
    restore: () => {
      (User as unknown as { findByPk: FindByPk }).findByPk = original;
    },
  };
};
