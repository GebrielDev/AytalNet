import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { tripsApi, reportsApi } from '../services/api';
import Modal from '../components/Modal';
import { RosterDetail, TripsDetail } from '../components/StatDetail';

// VITE_API_URL ends in /api. Socket.io reads a trailing path as a namespace,
// so connecting to it lands on /api, which the server has no handler for.
// Connect to the origin instead, where io.on('connection') is registered.
const SOCKET_URL = new URL(
  import.meta.env.VITE_API_URL || '/',
  window.location.origin
).origin;

// Shown in place of a figure that could not be loaded.
const NO_VALUE = '—';

interface Stats {
  totalDrivers: number;
  activeDrivers: number;
  totalVehicles: number;
  activeVehicles: number;
  activeTrips: number;
  todayTrips: number;
  weekTrips: number;
  monthTrips: number;
  // The instants the three trip counts were taken with. Sent by the server so
  // a drill-down filters on exactly what was counted - deriving them here
  // would use the browser's timezone and the list would disagree with the
  // number above it.
  ranges?: { today: string; week: string; month: string };
}

/** Which card's detail layer is open, if any. */
type Detail =
  | { kind: 'trips'; title: string; startDate: string }
  | { kind: 'drivers' }
  | { kind: 'vehicles' };

interface ActiveTrip {
  id: number;
  startTime: string;
  startOdometer: number;
  driver: { name: string; employeeId: string; phone: string };
  vehicle: { plateNumber: string; make: string; model: string };
}

/**
 * Whether the dashboard is actually receiving live updates.
 *
 * 'live'       - connected; trip events arrive as they happen.
 * 'connecting' - the transport dropped and socket.io is retrying on its own.
 * 'offline'    - it is not coming back without help. Socket.io does not retry a
 *                handshake the server rejected, nor a server-initiated
 *                disconnect, and the server now closes sockets at token expiry.
 *                This is the state a tab left open overnight lands in, with a
 *                board that quietly stopped updating.
 */
type FeedState = 'live' | 'connecting' | 'offline';

const FEED: Record<FeedState, { label: string; dot: string; ping: boolean; text: string }> = {
  live: { label: 'Live', dot: 'bg-green-500', ping: true, text: 'text-green-700' },
  connecting: { label: 'Reconnecting', dot: 'bg-amber-500', ping: true, text: 'text-amber-700' },
  offline: { label: 'Not live', dot: 'bg-gray-400', ping: false, text: 'text-gray-500' },
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTrips, setActiveTrips] = useState<ActiveTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsFailed, setStatsFailed] = useState(false);
  const [tripsFailed, setTripsFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feed, setFeed] = useState<FeedState>('connecting');
  const [detail, setDetail] = useState<Detail | null>(null);

  // A fetch and the socket both write activeTrips, and the fetch is not
  // instant. A trip:ended that lands while a refetch is in flight is NEWER than
  // the snapshot that refetch is about to return, so assigning the snapshot
  // would put the ended trip back on the board - and no later event would ever
  // correct it. Each socket update is therefore recorded as an operation and
  // replayed on top of whatever snapshot arrives after it.
  const opLog = useRef<{ seq: number; apply: (list: ActiveTrip[]) => ActiveTrip[] }[]>([]);
  const opSeq = useRef(0);
  // Two fetches can overlap (Retry pressed during a reconnect refetch). Only
  // the newest may write, or an older response could land last and win.
  const fetchGen = useRef(0);
  // Each in-flight fetch, by generation, with the op sequence it started at.
  // An op is still needed while any of them started before it.
  const inFlight = useRef<Map<number, number>>(new Map());

  const applyTripOp = useCallback((apply: (list: ActiveTrip[]) => ActiveTrip[]) => {
    opSeq.current += 1;
    opLog.current.push({ seq: opSeq.current, apply });
    // Prune by what the in-flight fetches could still replay, never by a fixed
    // length: a cap would evict ops a slow fetch still needs, which is the very
    // bug the log exists to prevent. With nothing in flight there is nothing to
    // replay onto, so the log empties.
    const oldestNeeded = inFlight.current.size
      ? Math.min(...inFlight.current.values())
      : opSeq.current;
    opLog.current = opLog.current.filter((op) => op.seq > oldestNeeded);
    setActiveTrips(apply);
  }, []);

  const fetchData = useCallback(async () => {
    const gen = (fetchGen.current += 1);
    const seqAtStart = opSeq.current;
    inFlight.current.set(gen, seqAtStart);

    // allSettled, not all: a failing summary used to discard a perfectly good
    // list of active trips along with it.
    const [statsRes, tripsRes] = await Promise.allSettled([
      reportsApi.getSummary(),
      tripsApi.getActive(),
    ]).finally(() => {
      inFlight.current.delete(gen);
    });

    if (gen !== fetchGen.current) return;

    if (statsRes.status === 'fulfilled') {
      setStats(statsRes.value.data);
      setStatsFailed(false);
    } else {
      console.error('Failed to fetch dashboard summary', statsRes.reason);
      setStatsFailed(true);
    }

    if (tripsRes.status === 'fulfilled') {
      const snapshot = tripsRes.value.data as ActiveTrip[];
      setActiveTrips(
        opLog.current
          .filter((op) => op.seq > seqAtStart)
          .reduce((list, op) => op.apply(list), snapshot)
      );
      setTripsFailed(false);
    } else {
      console.error('Failed to fetch active trips', tripsRes.reason);
      // The rows already on screen are kept rather than blanked - the last
      // known board beats no board - but they are now labelled as last known
      // rather than current, because a trip may have ended since.
      setTripsFailed(true);
    }
  }, []);

  const retry = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;

    fetchData().finally(() => {
      if (!cancelled) setLoading(false);
    });

    // The server now authenticates the handshake and refuses sockets without a
    // user token, so the feed must present one. The dashboard room is joined
    // server-side once that check passes; there is nothing to emit here.
    const socket: Socket = io(SOCKET_URL, {
      auth: { token: localStorage.getItem('accessToken') },
    });

    // The first connect rides along with the fetch above; only a reconnect has
    // a gap to close.
    let everConnected = false;

    socket.on('connect', () => {
      if (cancelled) return;
      setFeed('live');
      // Events that fired while the socket was down were queued nowhere.
      // Without this the board would claim to be live while missing every trip
      // that started during the gap.
      if (everConnected) fetchData();
      everConnected = true;
    });

    socket.on('trip:started', (trip: ActiveTrip) => {
      // A reconnect refetches, so the same trip can arrive twice - once in the
      // fetch, once from an event still in flight. Two rows with the same React
      // key is a rendering bug, and the count would be wrong too.
      applyTripOp((prev) =>
        prev.some((t) => t.id === trip.id) ? prev : [trip, ...prev]
      );
    });

    // Both take a trip off the board. cancelTrip emits { id } and endTrip emits
    // the trip row, so only the id is read from either. trip:cancelled was
    // emitted by the backend but listened for nowhere, which left a dispatcher
    // who cancelled a trip from the Trips page still looking at it under
    // "Active Trips" here - and counted in the total - until a reload.
    const removeTrip = (trip: { id: number }) =>
      applyTripOp((prev) => prev.filter((t) => t.id !== trip.id));

    socket.on('trip:ended', removeTrip);
    socket.on('trip:cancelled', removeTrip);

    // socket.active distinguishes "socket.io is still retrying" from "it has
    // given up", which is the difference between a blip and a dead feed.
    const stopped = () => {
      if (!cancelled) setFeed(socket.active ? 'connecting' : 'offline');
    };
    socket.on('disconnect', stopped);
    socket.on('connect_error', stopped);

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [fetchData, applyTripOp]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // A hard 0 is indistinguishable from a quiet fleet, so a stat that could not
  // be loaded says so rather than inventing a number.
  const statValue = (value: number | undefined): string | number =>
    statsFailed || value === undefined ? NO_VALUE : value;
  const statRatio = (active: number | undefined, total: number | undefined): string =>
    statsFailed || active === undefined || total === undefined
      ? NO_VALUE
      : `${active}/${total}`;

  // Active Trips reads the list rather than a separately maintained counter:
  // the two used to drift apart, because every socket event patched the
  // number by hand while the list was rebuilt from the server.
  // A card opens a detail layer only when the server sent the boundary its
  // count was taken with. Without it the list could not be guaranteed to match
  // the number, and a drill-down that disagrees with the card above it is
  // worse than none.
  const tripDetail = (title: string, startDate: string | undefined): Detail | undefined =>
    statsFailed || !startDate ? undefined : { kind: 'trips', title, startDate };

  // Active Trips is deliberately not clickable: the full list of them is
  // already on this page, directly below.
  const statCards: {
    label: string;
    value: string | number;
    bg: string;
    text: string;
    icon: JSX.Element;
    detail?: Detail;
  }[] = [
    { label: 'Active Trips', value: tripsFailed ? NO_VALUE : activeTrips.length, bg: 'bg-emerald-50', text: 'text-emerald-700', icon: (
      <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 1012.728 0M12 2.25v6" /></svg>
    )},
    { label: "Today's Trips", value: statValue(stats?.todayTrips), detail: tripDetail("Today's Trips", stats?.ranges?.today), bg: 'bg-blue-50', text: 'text-blue-700', icon: (
      <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    )},
    { label: 'This Week', value: statValue(stats?.weekTrips), detail: tripDetail('This Week', stats?.ranges?.week), bg: 'bg-violet-50', text: 'text-violet-700', icon: (
      <svg className="w-6 h-6 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
    )},
    { label: 'This Month', value: statValue(stats?.monthTrips), detail: tripDetail('This Month', stats?.ranges?.month), bg: 'bg-amber-50', text: 'text-amber-700', icon: (
      <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
    )},
    { label: 'Active Drivers', value: statRatio(stats?.activeDrivers, stats?.totalDrivers), detail: statsFailed ? undefined : { kind: 'drivers' }, bg: 'bg-teal-50', text: 'text-teal-700', icon: (
      <svg className="w-6 h-6 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
    )},
    { label: 'Active Vehicles', value: statRatio(stats?.activeVehicles, stats?.totalVehicles), detail: statsFailed ? undefined : { kind: 'vehicles' }, bg: 'bg-indigo-50', text: 'text-indigo-700', icon: (
      <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25m-2.25 0V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75" /></svg>
    )},
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Fleet overview and real-time activity</p>
      </div>

      {/* A failed fetch used to go to the console and nowhere else, leaving a
          dashboard of zeros that reads exactly like a quiet fleet. */}
      {(statsFailed || tripsFailed) && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-start justify-between gap-4"
        >
          <div>
            <p className="text-sm font-semibold text-red-800">
              {statsFailed && tripsFailed
                ? "Couldn't load the dashboard"
                : statsFailed
                ? "Couldn't load the fleet totals"
                : "Couldn't load the active trips"}
            </p>
            <p className="text-xs text-red-700 mt-1">
              The figures below are incomplete. Check the connection and try again.
            </p>
          </div>
          <button
            type="button"
            onClick={retry}
            disabled={refreshing}
            className="shrink-0 text-sm font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((stat) => {
          const body = (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-lg ${stat.bg}`}>{stat.icon}</div>
                {stat.detail && (
                  <svg
                    className="w-4 h-4 text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                )}
              </div>
              <p className={`text-2xl font-bold ${stat.text}`}>{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </>
          );

          const shell = 'bg-white rounded-xl border border-gray-200 p-4 transition-shadow';

          // A div with an onClick is unreachable by keyboard and invisible to a
          // screen reader, so a card that does something is a button.
          return stat.detail ? (
            <button
              key={stat.label}
              type="button"
              onClick={() => setDetail(stat.detail!)}
              aria-label={`${stat.label}: ${stat.value}. Show details`}
              className={`${shell} text-left hover:shadow-md hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`}
            >
              {body}
            </button>
          ) : (
            <div key={stat.label} className={`${shell} hover:shadow-md`}>
              {body}
            </div>
          );
        })}
      </div>

      {/* Active trips */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              Active Trips
              {tripsFailed && activeTrips.length > 0 && (
                <span className="text-[11px] font-medium uppercase tracking-wide bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                  Stale
                </span>
              )}
            </h2>
            {/* Rows retained from before a failed refresh are not current: a
                trip may have ended since. Saying so beats both blanking them
                and presenting them as live. */}
            <p className={`text-xs mt-0.5 ${tripsFailed ? 'text-amber-700' : 'text-gray-500'}`}>
              {!tripsFailed
                ? `${activeTrips.length} trip${activeTrips.length !== 1 ? 's' : ''} in progress`
                : activeTrips.length > 0
                ? `Last known ${activeTrips.length} trip${activeTrips.length !== 1 ? 's' : ''} - not current`
                : 'Count unavailable'}
            </p>
          </div>
          {/* This pinged green whatever the socket was doing, so it reassured
              most convincingly when the feed was dead. It now reports the real
              connection state, and says so in words for anyone who cannot
              distinguish the colours. */}
          <span className={`flex items-center gap-2 text-xs font-medium ${FEED[feed].text}`}>
            <span className="relative flex h-2.5 w-2.5">
              {FEED[feed].ping && (
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full ${FEED[feed].dot} opacity-75`}
                />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${FEED[feed].dot}`}
              />
            </span>
            {FEED[feed].label}
            {feed === 'offline' && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="underline underline-offset-2 hover:text-gray-700"
              >
                Reload
              </button>
            )}
          </span>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Driver</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vehicle</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start Time</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Odometer</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {activeTrips.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                    {tripsFailed ? 'Active trips unavailable' : 'No active trips at the moment'}
                  </td>
                </tr>
              ) : (
                activeTrips.map((trip) => (
                  <tr key={trip.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                          {trip.driver?.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{trip.driver?.name}</div>
                          <div className="text-xs text-gray-500">{trip.driver?.employeeId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-medium text-gray-900">{trip.vehicle?.plateNumber}</div>
                      <div className="text-xs text-gray-500">{trip.vehicle?.make} {trip.vehicle?.model}</div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {new Date(trip.startTime).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {trip.startOdometer} mi
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {trip.driver?.phone}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {activeTrips.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {tripsFailed ? 'Active trips unavailable' : 'No active trips'}
            </div>
          ) : (
            activeTrips.map((trip) => (
              <div key={trip.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                      {trip.driver?.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{trip.driver?.name}</p>
                      <p className="text-xs text-gray-500">{trip.driver?.employeeId}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      tripsFailed ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {tripsFailed ? 'Last known' : 'Active'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <div><span className="font-medium text-gray-700">Vehicle:</span> {trip.vehicle?.plateNumber}</div>
                  <div><span className="font-medium text-gray-700">Odometer:</span> {trip.startOdometer} mi</div>
                  <div><span className="font-medium text-gray-700">Started:</span> {new Date(trip.startTime).toLocaleTimeString()}</div>
                  <div><span className="font-medium text-gray-700">Phone:</span> {trip.driver?.phone}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* The card labels are rolling windows, not calendar ones: "This Week"
          is the last 7 days and "This Month" the last month. Stating the
          actual boundary here means the list cannot be read as something it
          is not, without renaming the cards. */}
      <Modal
        open={detail !== null}
        title={
          detail === null
            ? ''
            : detail.kind === 'trips'
            ? detail.title
            : detail.kind === 'drivers'
            ? 'Active Drivers'
            : 'Active Vehicles'
        }
        subtitle={
          detail?.kind === 'trips'
            ? `Trips started since ${new Date(detail.startDate).toLocaleString()}`
            : detail
            ? `Currently active ${detail.kind}`
            : undefined
        }
        onClose={() => setDetail(null)}
      >
        {detail?.kind === 'trips' && <TripsDetail startDate={detail.startDate} />}
        {detail?.kind === 'drivers' && <RosterDetail kind="drivers" />}
        {detail?.kind === 'vehicles' && <RosterDetail kind="vehicles" />}
      </Modal>
    </div>
  );
}
