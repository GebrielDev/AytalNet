import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { driversApi } from '../services/api';
import StopsModal from '../components/StopsModal';

interface BoardStop {
  id: number;
  position: number;
  address: string;
  note: string | null;
  latitude: number | null;
  arrivedAt: string | null;
  arrivedDistanceMeters: number | null;
}

interface BoardRow {
  driverId: number;
  name: string;
  employeeId: string;
  plate: string | null;
  activeTrip: { id: number; startTime: string } | null;
  stops: BoardStop[];
  done: number;
  total: number;
}

const SOCKET_URL = new URL(import.meta.env.VITE_API_URL || '/', window.location.origin).origin;

// Today's times as 8:30 AM; anything older with its date.
const time = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
};

/**
 * Every driver's stops on one page, updating live: a stop reached, a list
 * edited, a trip started or ended - the board refreshes within a moment.
 */
export default function StopsBoard() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [showIdle, setShowIdle] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      const res = await driversApi.getStopsBoard();
      setRows(res.data);
      setError('');
    } catch {
      setError('Could not load the stops board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const socket = io(SOCKET_URL, {
      path: import.meta.env.VITE_SOCKET_PATH || '/socket.io',
      auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
    });
    // Several events can arrive together (an arrival also changes the list);
    // one refresh covers them.
    const refresh = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 300);
    };
    socket.on('connect', () => {
      setLive(true);
      refresh();
    });
    // The server closes the socket when the access token expires (and refuses
    // an expired one); socket.io does not retry those by itself. A REST call
    // renews the token through the API client, then the socket rejoins.
    // Cleared on unmount, so leaving the page never reopens a socket.
    const retries: ReturnType<typeof setTimeout>[] = [];
    let closed = false;
    const rejoin = async () => {
      if (closed) return;
      await load();
      if (!closed) socket.connect();
    };
    socket.on('disconnect', (reason) => {
      setLive(false);
      if (reason === 'io server disconnect') retries.push(setTimeout(rejoin, 1000));
    });
    socket.on('connect_error', (err) => {
      setLive(false);
      if (/token|Authentication|User not found/i.test(err.message)) retries.push(setTimeout(rejoin, 3000));
    });
    socket.on('stops:changed', refresh);
    socket.on('trip:started', refresh);
    socket.on('trip:ended', refresh);
    socket.on('trip:cancelled', refresh);
    socket.on('driver:arrived', (a: { driverId: number }) => {
      setFlash(a.driverId);
      setTimeout(() => setFlash((f) => (f === a.driverId ? null : f)), 4000);
      refresh();
    });
    return () => {
      closed = true;
      retries.forEach(clearTimeout);
      clearTimeout(timer.current);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [load]);

  const working = rows.filter((r) => r.total > r.done);
  const finished = rows.filter((r) => r.total > 0 && r.total === r.done);
  const idle = rows.filter((r) => r.total === 0);
  const shown = [...working, ...finished, ...(showIdle ? idle : [])];
  const stopsLeft = working.reduce((n, r) => n + r.total - r.done, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stops Board</h1>
          <p className="text-sm text-gray-500 mt-1" data-testid="stops-board-summary">
            {loading ? 'Loading…' : `${working.length} driver${working.length === 1 ? '' : 's'} with stops to visit · ${stopsLeft} stop${stopsLeft === 1 ? '' : 's'} to go · ${finished.length} finished`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" data-testid="stops-board-show-idle" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
            Show drivers without stops ({idle.length})
          </label>
          <span data-testid="stops-board-live" className={`inline-flex items-center gap-1.5 text-xs font-medium ${live ? 'text-green-700' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${live ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            {live ? 'Live' : 'Reconnecting…'}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600" data-testid="stops-board-error">{error}</p>}

      {!loading && shown.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500" data-testid="stops-board-empty">
          No driver has stops right now. Add some from the Drivers page{idle.length ? ', or tick "Show drivers without stops"' : ''}.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => {
          const nextId = r.stops.find((s) => !s.arrivedAt)?.id;
          const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
          return (
            <div
              key={r.driverId}
              data-testid={`stops-board-driver-${r.driverId}`}
              className={`min-w-0 bg-white rounded-xl border p-4 transition-shadow ${flash === r.driverId ? 'border-green-400 shadow-lg shadow-green-100' : 'border-gray-200'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    {r.employeeId}
                    {r.plate ? ` · ${r.plate}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {r.activeTrip ? (
                    <span data-testid={`stops-board-on-trip-${r.driverId}`} className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">On trip since {time(r.activeTrip.startTime)}</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">No trip</span>
                  )}
                  <button data-testid={`stops-board-edit-${r.driverId}`} onClick={() => setEditing({ id: r.driverId, name: r.name })} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-2 -mr-2">
                    {r.total ? 'Edit stops' : 'Add stops'}
                  </button>
                </div>
              </div>

              {r.total > 0 && (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-medium text-gray-600" data-testid={`stops-board-progress-${r.driverId}`}>
                      {r.done}/{r.total}
                    </span>
                  </div>
                  <ol className="mt-3 space-y-2">
                    {r.stops.map((s) => (
                      <li key={s.id} className="flex gap-2 text-sm" data-testid={`stops-board-stop-${s.id}`}>
                        <span
                          className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                            s.arrivedAt ? 'bg-green-100 text-green-700' : s.id === nextId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {s.arrivedAt ? '✓' : s.position}
                        </span>
                        <span className="min-w-0">
                          <span className={`block truncate ${s.arrivedAt ? 'text-gray-400 line-through' : s.id === nextId ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>{s.address}</span>
                          {s.arrivedAt ? (
                            <span className="text-xs text-green-700">Arrived {time(s.arrivedAt)}{s.arrivedDistanceMeters != null ? ` · ${s.arrivedDistanceMeters} m` : ''}</span>
                          ) : s.id === nextId ? (
                            <span className="text-xs text-blue-700">Next stop{s.latitude == null ? ' · not on the map' : ''}</span>
                          ) : s.latitude == null ? (
                            <span className="text-xs text-amber-700">Not on the map</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          );
        })}
      </div>

      {editing && <StopsModal driver={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
