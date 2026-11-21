import jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import { authConfig } from './config/auth';
import { User, Driver } from './models';
import { tokenIsCurrent } from './middleware/auth';

/**
 * Everything that governs the dashboard socket namespace lives here rather than
 * in index.ts, so the handshake and the revocation paths can be driven from a
 * test without booting the whole server.
 */

/**
 * Every authenticated dashboard socket joins a room named after its own user,
 * so a single user's live connections can be severed without scanning all of
 * them. Socket.IO's rooms are adapter-backed, so this keeps working if the API
 * is ever run as more than one process.
 */
export const userRoom = (userId: number | string): string => `user:${userId}`;

/**
 * Closes every live dashboard socket belonging to a user.
 *
 * The socket handshake authenticates once, but the connection then lives for as
 * long as the tab stays open: the expiry timer below bounds that to the token
 * lifetime, which is up to an hour. Without this, a dispatcher deleted through
 * deleteUser would keep receiving driver names, employee IDs, vehicle plates
 * and trip GPS for the rest of that hour, even though the REST path rejects
 * them on their very next request.
 *
 * `disconnect(true)` closes the underlying transport rather than just the
 * namespace, so the client reconnects and re-runs the handshake - which then
 * fails the User.findByPk check below.
 */
export const disconnectUserSockets = (io: Server | undefined, userId: number | string): void => {
  if (!io) return;
  io.in(userRoom(userId)).disconnectSockets(true);
};

/**
 * The dashboard feed carries driver names, employee IDs, vehicle plates and
 * trip GPS. Without this, any client that completed the handshake received all
 * of it - which contradicts the privacy policy's claim that only dispatchers
 * and administrators can see trip data.
 */
export const authenticateDashboardSocket = async (
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    next(new Error('Authentication required'));
    return;
  }
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret, { algorithms: ['HS256'] }) as {
      id: number;
      type?: string;
      exp?: number;
      ver?: number;
    };
    if (decoded.type !== 'user') {
      next(new Error('Dashboard access is limited to dispatchers and administrators'));
      return;
    }
    // Matches authenticateToken: the signed claims are not enough on their own.
    // A dispatcher deleted through deleteUser still holds a valid token until it
    // expires, and without this would keep receiving the feed for up to an hour.
    const user = await User.findByPk(decoded.id);
    if (!user || !tokenIsCurrent(decoded, user)) {
      next(new Error('User not found'));
      return;
    }
    socket.data.userId = decoded.id;
    socket.data.tokenExp = decoded.exp;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
};

const onDashboardConnection = (socket: Socket): void => {
  // Joined on connect rather than on request: the handshake above has already
  // established that this socket belongs to a dispatcher or administrator.
  socket.join('dashboard');

  // A per-user room so deleteUser can sever this user's live connections
  // immediately, instead of leaving them to run out the token's expiry below.
  // The role an account holds does not change what the dashboard feed carries -
  // admins and dispatchers receive the same events - so a demotion needs no
  // equivalent; the admin-only REST routes re-check the role on every request.
  const userId = socket.data.userId as number | undefined;
  if (userId !== undefined) {
    socket.join(userRoom(userId));
  }

  // The handshake runs once, but a socket lives for as long as the tab stays
  // open. Without this, an expired token keeps streaming driver names and trip
  // GPS indefinitely, which would leave the socket weaker than the REST path,
  // where authenticateToken re-checks the user on every request.
  //
  // Closing at the token's own expiry bounds that to the token lifetime and
  // makes the client reconnect, which re-runs the full handshake.
  const exp = socket.data.tokenExp as number | undefined;
  const expiresInMs = exp ? exp * 1000 - Date.now() : 0;
  const expiryTimer = setTimeout(
    () => socket.disconnect(true),
    Math.max(0, expiresInMs)
  );

  socket.on('disconnect', () => {
    clearTimeout(expiryTimer);
    socket.leave('dashboard');
    if (userId !== undefined) {
      socket.leave(userRoom(userId));
    }
  });
};

/** Installs the dashboard handshake and connection handling on an io server. */
export const configureDashboardSocket = (io: Server): Server => {
  io.use(authenticateDashboardSocket);
  io.on('connection', onDashboardConnection);
  return io;
};

/**
 * The driver app's namespace (/driver), kept apart from the dashboard feed so
 * a driver token can never join the 'dashboard' room. A driver socket only
 * joins its own room and only receives what is addressed to that driver,
 * today the destination the dispatcher sets.
 */
export const driverRoom = (driverId: number | string): string => `driver:${driverId}`;

export const authenticateDriverSocket = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    next(new Error('Authentication required'));
    return;
  }
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret, { algorithms: ['HS256'] }) as { id: number; type?: string; exp?: number; ver?: number };
    if (decoded.type !== 'driver') {
      next(new Error('Driver access only'));
      return;
    }
    const driver = await Driver.findByPk(decoded.id);
    if (!driver || driver.status !== 'active' || !tokenIsCurrent(decoded, driver)) {
      next(new Error('Driver not found'));
      return;
    }
    socket.data.driverId = decoded.id;
    socket.data.tokenExp = decoded.exp;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
};

const onDriverConnection = (socket: Socket): void => {
  socket.join(driverRoom(socket.data.driverId));
  // Same bound as the dashboard: closed at token expiry, the app reconnects
  // with a fresh token.
  const exp = socket.data.tokenExp as number | undefined;
  const timer = setTimeout(() => socket.disconnect(true), Math.max(0, exp ? exp * 1000 - Date.now() : 0));
  socket.on('disconnect', () => clearTimeout(timer));
};

export const configureDriverSocket = (io: Server): Server => {
  const nsp = io.of('/driver');
  nsp.use(authenticateDriverSocket);
  nsp.on('connection', onDriverConnection);
  return io;
};
