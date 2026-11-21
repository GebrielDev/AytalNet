import { tokenStorage } from './tokenStorage';
import { API_URL, SOCKET_PATH } from '../config';
import { io, Socket } from 'socket.io-client';
import { getStops, setStopsLocal, syncNow } from './offlineTrips';
import { fetchNotes, setNotesLocal } from './notes';

/**
 * A live line to the server while the app is open, so the stops the
 * dispatcher sets appear on the phone at once instead of on the next visit
 * to Home. Uses the /driver namespace, which only ever carries this driver's
 * own updates.
 *
 * Without signal it just stays disconnected and socket.io keeps retrying;
 * the destination saved on the phone is shown meanwhile.
 */

const ORIGIN = API_URL.replace(/\/api\/?$/, '');
const PATH = SOCKET_PATH;

let socket: Socket | null = null;

const refreshThenReconnect = async () => {
  // Any authenticated request renews an expired access token via the API
  // client's interceptor; it also catches up on a change missed meanwhile.
  await getStops();
  socket?.connect();
};

export const startLiveUpdates = (driverId: number | null): (() => void) => {
  if (driverId == null) return () => {};

  socket = io(`${ORIGIN}/driver`, {
    path: PATH,
    transports: ['websocket'],
    // Read on every (re)connect, so a renewed token is picked up.
    auth: (cb) => {
      tokenStorage.getAccess().then((token) => cb({ token }));
    },
  });

  socket.on('stops:updated', (stops) => {
    setStopsLocal(Array.isArray(stops) ? stops : []);
  });

  // A refused handshake (expired token) or the server closing the socket at
  // token expiry both stop socket.io's own retries; renew and come back.
  socket.on('connect_error', (error) => {
    if (/token|Authentication/i.test(error.message)) setTimeout(refreshThenReconnect, 3000);
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') setTimeout(refreshThenReconnect, 1000);
  });
  // Back online after a gap: fetch once in case an update was missed.
  socket.on('notes:updated', setNotesLocal);
  socket.on('connect', () => {
    // Back online: send anything saved on the phone, then refresh.
    syncNow().finally(getStops);
    fetchNotes();
  });

  // Backstop: if the socket has been down for two checks in a row (~60 s),
  // socket.io may be stuck; start a fresh connection.
  let downTicks = 0;
  const watchdog = setInterval(() => {
    if (!socket || socket.connected) {
      downTicks = 0;
      return;
    }
    downTicks += 1;
    if (downTicks >= 2) {
      downTicks = 0;
      socket.disconnect();
      socket.connect();
    }
  }, 30000);

  return () => {
    clearInterval(watchdog);
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
  };
};
