import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

import { authConfig } from '../../src/config/auth';
import { deleteUser } from '../../src/controllers/userController';
import { configureDashboardSocket } from '../../src/socket';
// Imported for its `declare global` augmentation of Express's Request, which
// is what puts `req.user` on the type below.
import '../../src/middleware/auth';

/**
 * A real socket.io server wired up by the application's own
 * configureDashboardSocket, with the real deleteUser controller mounted on an
 * Express app that exposes `io` the same way index.ts does.
 *
 * The route's own auth middleware is deliberately left off: these tests are
 * about socket revocation, and deleteUser only reads req.user to refuse
 * self-deletion. `actingUserId` stands in for the authenticated admin.
 */
export interface DashboardServer {
  io: Server;
  port: number;
  /** Connects a client authenticated as `userId`. Rejects if the handshake does. */
  connect(userId: number, options?: { expiresIn?: string | number }): Promise<ClientSocket>;
  /** Signs a token the way the login route does. */
  token(userId: number, options?: { expiresIn?: string | number; type?: string }): string;
  /** Calls DELETE /api/users/:id and resolves with the status code. */
  deleteUser(userId: number): Promise<number>;
  /** Connects with an arbitrary auth payload, for handshake-rejection cases. */
  connectWith(auth: Record<string, unknown>): Promise<ClientSocket>;
  close(): Promise<void>;
}

export const startDashboardServer = async (
  actingUserId = 99
): Promise<DashboardServer> => {
  const app = express();
  const server = http.createServer(app);
  const io = configureDashboardSocket(new Server(server));

  app.set('io', io);
  app.delete('/api/users/:id', (req, res) => {
    req.user = { id: actingUserId } as typeof req.user;
    return deleteUser(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  const clients: ClientSocket[] = [];

  const token: DashboardServer['token'] = (userId, options = {}) =>
    jwt.sign({ id: userId, type: options.type ?? 'user' }, authConfig.jwtSecret, {
      expiresIn: options.expiresIn ?? '1h',
    } as jwt.SignOptions);

  const connectWith: DashboardServer['connectWith'] = (auth) =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, { auth, reconnection: false });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', (error) => reject(error));
    });

  return {
    io,
    port,
    token,
    connect: (userId, options) => connectWith({ token: token(userId, options) }),
    connectWith,
    deleteUser: (userId) =>
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
export const waitForDisconnect = (socket: ClientSocket, timeoutMs = 3000): Promise<void> =>
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
export const collect = (socket: ClientSocket, event: string): unknown[] => {
  const received: unknown[] = [];
  socket.on(event, (payload: unknown) => received.push(payload));
  return received;
};

/** Gives the event loop time to deliver (or fail to deliver) a broadcast. */
export const settle = (ms = 100): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
