import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';

interface Arrival {
  stopId: number;
  driverName: string;
  address: string;
  distanceMeters: number | null;
  how: 'driver' | 'trip_end';
  at: string;
}

const SOCKET_URL = new URL(import.meta.env.VITE_API_URL || '/', window.location.origin).origin;

/**
 * Pops up on every dashboard page the moment a driver reaches a stop, either
 * by tapping "I've arrived" or by ending a trip there. Each notice stays for
 * 20 seconds or until dismissed.
 */
export default function ArrivalNotices() {
  const [notices, setNotices] = useState<Arrival[]>([]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: import.meta.env.VITE_SOCKET_PATH || '/socket.io',
      // Read on each (re)connect so a refreshed token is used.
      auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
    });
    socket.on('driver:arrived', (arrival: Arrival) => {
      setNotices((list) => [arrival, ...list.filter((n) => n.stopId !== arrival.stopId)].slice(0, 4));
      setTimeout(() => setNotices((list) => list.filter((n) => n.stopId !== arrival.stopId)), 20000);
    });
    // Rejoin after the server closes the socket at token expiry: a REST call
    // renews the token via the API client first.
    // Cleared on unmount, so leaving the page never reopens a socket.
    const retries: ReturnType<typeof setTimeout>[] = [];
    let closed = false;
    const rejoin = async () => {
      if (closed) return;
      try {
        await api.get('/auth/me');
      } finally {
        if (!closed) socket.connect();
      }
    };
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') retries.push(setTimeout(rejoin, 1000));
    });
    socket.on('connect_error', (err) => {
      if (/token|Authentication|User not found/i.test(err.message)) retries.push(setTimeout(rejoin, 3000));
    });
    return () => {
      closed = true;
      retries.forEach(clearTimeout);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  if (!notices.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-80 max-w-[calc(100vw-2rem)]" data-testid="arrival-notices">
      {notices.map((n) => (
        <div key={n.stopId} className="bg-white border border-green-200 shadow-lg rounded-xl p-4 flex gap-3" data-testid={`arrival-notice-${n.stopId}`}>
          <span className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold shrink-0">✓</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-gray-900">{n.driverName} arrived</p>
            <p className="text-gray-600 line-clamp-2">{n.address}</p>
            <p className="text-xs text-gray-400 mt-1">
              {new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {n.how === 'trip_end' ? ' · trip ended here' : ' · confirmed by driver'}
              {n.distanceMeters != null ? ` · ${n.distanceMeters} m from the stop` : ''}
            </p>
          </div>
          <button data-testid={`arrival-notice-dismiss-${n.stopId}`} onClick={() => setNotices((l) => l.filter((x) => x.stopId !== n.stopId))} className="text-gray-400 hover:text-gray-700 self-start" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
