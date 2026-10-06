import { Server } from 'socket.io';

/**
 * Every authenticated dashboard socket joins a room named after its own user,
 * so a single user's live connections can be severed without scanning all of
 * them. Socket.IO's own rooms are adapter-backed, so this keeps working if the
 * API is ever run as more than one process.
 */
export const userRoom = (userId: number | string): string => `user:${userId}`;

/**
 * Closes every live dashboard socket belonging to a user.
 *
 * The socket handshake authenticates once, but the connection then lives for as
 * long as the tab stays open: the expiry timer in index.ts bounds that to the
 * token lifetime, which is up to an hour. Without this, a dispatcher deleted
 * through deleteUser would keep receiving driver names, employee IDs, vehicle
 * plates and trip GPS for the rest of that hour, even though the REST path
 * rejects them on their very next request.
 *
 * `disconnect(true)` closes the underlying transport rather than just the
 * namespace, so the client reconnects and re-runs the handshake - which now
 * fails the User.findByPk check.
 */
export const disconnectUserSockets = (io: Server | undefined, userId: number | string): void => {
  if (!io) return;
  io.in(userRoom(userId)).disconnectSockets(true);
};
