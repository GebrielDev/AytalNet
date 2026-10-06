import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

const SECRET = 'test-secret';

// Same shape as the other controller tests: the models and the auth config are
// mocked so nothing opens a database connection or needs real secrets.
const findByPkUser = vi.fn();
vi.mock('./models', () => ({
  User: { findByPk: (...a: unknown[]) => findByPkUser(...a) },
}));
vi.mock('./config/auth', () => ({
  authConfig: { get jwtSecret() { return 'test-secret'; }, saltRounds: 10 },
}));

const DISPATCHER = 1;
const OTHER_DISPATCHER = 2;
const ACTING_ADMIN = 99;

/**
 * A real socket.io server wired up by the application's own
 * configureDashboardSocket, with the real deleteUser controller mounted on an
 * Express app that exposes `io` the same way index.ts does.
 *
 * The route's own auth middleware is deliberately left off: these tests are
 * about socket revocation, and deleteUser only reads req.user to refuse
 * self-deletion.
 */
const startServer = async () => {
  const { configureDashboardSocket } = await import('./socket');
  const { deleteUser } = await import('./controllers/userController');

  const app = express();
  const server = http.createServer(app);
  const io = configureDashboardSocket(new Server(server));

  app.set('io', io);
  app.delete('/api/users/:id', (req, res) => {
    req.user = { id: ACTING_ADMIN } as typeof req.user;
    return deleteUser(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const clients: ClientSocket[] = [];

  const token = (userId: number, options: { expiresIn?: string; type?: string } = {}) =>
    jwt.sign({ id: userId, type: options.type ?? 'user' }, SECRET, {
      expiresIn: options.expiresIn ?? '1h',
    } as jwt.SignOptions);

  const connectWith = (auth: Record<string, unknown>): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, { auth, reconnection: false });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
    });

  return {
    io,
    token,
    connectWith,
    connect: (userId: number, options?: { expiresIn?: string }) =>
      connectWith({ token: token(userId, options) }),
    deleteUser: (userId: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const request = http.request(
          { port, host: '127.0.0.1', method: 'DELETE', path: `/api/users/${userId}` },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode as number));
          }
        );
        request.on('error', reject);
        request.end();
      }),
    close: async () => {
      clients.forEach((client) => client.close());
      await io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

/** Resolves once the socket is closed, or rejects if it stays open. */
const waitForDisconnect = (socket: ClientSocket, timeoutMs = 3000): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!socket.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`socket still connected after ${timeoutMs}ms`)),
      timeoutMs
    );
    socket.on('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Collects events of one name, so a test can assert nothing further arrives. */
const collect = (socket: ClientSocket, event: string): unknown[] => {
  const received: unknown[] = [];
  socket.on(event, (payload: unknown) => received.push(payload));
  return received;
};

/** Gives the event loop time to deliver (or fail to deliver) a broadcast. */
const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

describe('dashboard socket', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let userRoom: (id: number | string) => string;
  let live: Set<number>;

  beforeAll(async () => {
    ({ userRoom } = await import('./socket'));
    server = await startServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    live = new Set([DISPATCHER, OTHER_DISPATCHER, ACTING_ADMIN]);
    // Mirrors what deleteUser does to the row it fetched: destroy() removes the
    // id, so later lookups fail the way a real delete makes them fail.
    findByPkUser.mockImplementation(async (id: unknown) => {
      const numeric = Number(id);
      if (!live.has(numeric)) return null;
      return { id: numeric, destroy: async () => void live.delete(numeric) };
    });
  });

  afterEach(() => {
    findByPkUser.mockReset();
  });

  describe('handshake', () => {
    it('rejects a connection with no token', async () => {
      await expect(server.connectWith({})).rejects.toThrow(/Authentication required/);
    });

    it('rejects a token that is not a user token', async () => {
      await expect(
        server.connectWith({ token: server.token(DISPATCHER, { type: 'driver' }) })
      ).rejects.toThrow(/limited to dispatchers and administrators/);
    });

    it('rejects a garbled token', async () => {
      await expect(server.connectWith({ token: 'not-a-jwt' })).rejects.toThrow(/Invalid token/);
    });

    it('rejects a validly signed token for a user that no longer exists', async () => {
      const token = server.token(DISPATCHER);
      live.delete(DISPATCHER);
      await expect(server.connectWith({ token })).rejects.toThrow(/User not found/);
    });

    it('admits a dispatcher and joins them to the dashboard and per-user rooms', async () => {
      const socket = await server.connect(DISPATCHER);

      expect(socket.connected).toBe(true);
      expect(server.io.sockets.adapter.rooms.get('dashboard')?.size).toBe(1);
      expect(server.io.sockets.adapter.rooms.get(userRoom(DISPATCHER))?.size).toBe(1);

      socket.close();
      await settle();
    });

    it('closes the socket when the token expires', async () => {
      const socket = await server.connect(DISPATCHER, { expiresIn: '1s' });
      const events = collect(socket, 'trip:started');

      await waitForDisconnect(socket);

      server.io.to('dashboard').emit('trip:started', { id: 1 });
      await settle();
      expect(events).toEqual([]);
    });
  });

  describe('when a user is deleted', () => {
    it('disconnects their live sockets and leaves other users connected', async () => {
      const doomed = await server.connect(DISPATCHER);
      const bystander = await server.connect(OTHER_DISPATCHER);
      const doomedEvents = collect(doomed, 'trip:started');
      const bystanderEvents = collect(bystander, 'trip:started');

      // Baseline: the feed reaches both while both users exist.
      server.io.to('dashboard').emit('trip:started', { id: 1 });
      await settle();
      expect(doomedEvents).toHaveLength(1);
      expect(bystanderEvents).toHaveLength(1);

      expect(await server.deleteUser(DISPATCHER)).toBe(200);
      await waitForDisconnect(doomed);

      expect(doomed.connected).toBe(false);
      expect(bystander.connected).toBe(true);

      // The deleted user must receive nothing further; the bystander must not
      // have been caught in the blast radius.
      server.io.to('dashboard').emit('trip:started', { id: 2 });
      await settle();
      expect(doomedEvents, 'deleted user received a post-deletion emit').toHaveLength(1);
      expect(bystanderEvents).toHaveLength(2);

      bystander.close();
      await settle();
    });

    it('leaves no dashboard or per-user room membership behind', async () => {
      const socket = await server.connect(DISPATCHER);
      expect(server.io.sockets.adapter.rooms.get('dashboard')?.size).toBe(1);

      expect(await server.deleteUser(DISPATCHER)).toBe(200);
      await waitForDisconnect(socket);
      await settle();

      expect(server.io.sockets.adapter.rooms.get('dashboard')).toBeUndefined();
      expect(server.io.sockets.adapter.rooms.get(userRoom(DISPATCHER))).toBeUndefined();
    });

    it('disconnects every socket that user had open', async () => {
      const first = await server.connect(DISPATCHER);
      const second = await server.connect(DISPATCHER);
      expect(server.io.sockets.adapter.rooms.get(userRoom(DISPATCHER))?.size).toBe(2);

      expect(await server.deleteUser(DISPATCHER)).toBe(200);
      await Promise.all([waitForDisconnect(first), waitForDisconnect(second)]);

      expect(first.connected).toBe(false);
      expect(second.connected).toBe(false);
    });

    it('rejects a reconnect that still carries the pre-deletion token', async () => {
      const token = server.token(DISPATCHER);
      const socket = await server.connectWith({ token });

      expect(await server.deleteUser(DISPATCHER)).toBe(200);
      await waitForDisconnect(socket);

      // The token is still within its hour; the handshake's existence check is
      // what has to turn it away.
      await expect(server.connectWith({ token })).rejects.toThrow(/User not found/);
    });

    it("refuses self-deletion without touching that user's socket", async () => {
      const socket = await server.connect(ACTING_ADMIN);

      expect(await server.deleteUser(ACTING_ADMIN)).toBe(400);
      await settle();

      expect(socket.connected).toBe(true);
      socket.close();
      await settle();
    });

    it('returns 404 for a user that does not exist', async () => {
      expect(await server.deleteUser(12345)).toBe(404);
    });
  });
});
