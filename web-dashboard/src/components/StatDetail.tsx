import { useCallback, useEffect, useState } from 'react';
import { driversApi, tripsApi, vehiclesApi } from '../services/api';

const PAGE_SIZE = 10;

interface TripRow {
  id: number;
  startTime: string;
  endTime?: string | null;
  status: string;
  durationMinutes?: number | null;
  totalMileage?: number | null;
  driver?: { name: string; employeeId: string } | null;
  vehicle?: { plateNumber: string } | null;
}

interface PersonRow {
  id: number;
  name: string;
  employeeId?: string;
  email?: string;
  phone?: string;
  status: string;
}

interface VehicleRow {
  id: number;
  plateNumber: string;
  make?: string;
  model?: string;
  year?: number;
  currentOdometer?: number | null;
  status: string;
}

const STATUS_STYLE: Record<string, string> = {
  in_progress: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-800',
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-gray-100 text-gray-700',
  maintenance: 'bg-amber-100 text-amber-800',
};

const Badge = ({ status }: { status: string }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-700'
    }`}
  >
    {status.replace('_', ' ')}
  </span>
);

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="px-5 py-10 text-center text-sm text-gray-500">{children}</div>
);

const Spinner = () => (
  <Centered>
    <div className="inline-block w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
  </Centered>
);

/**
 * Says what went wrong and offers another go, rather than an empty table that
 * is indistinguishable from "nothing to show".
 */
const Failed = ({ onRetry }: { onRetry: () => void }) => (
  <Centered>
    <p className="text-red-700">That did not load.</p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-3 text-sm font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
    >
      Try again
    </button>
  </Centered>
);

/** The trips behind one of the time-window cards. */
export function TripsDetail({ startDate }: { startDate: string }) {
  const [rows, setRows] = useState<TripRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (wanted: number) => {
      setLoading(true);
      setFailed(false);
      try {
        // startDate is the server's own boundary, passed through untouched, so
        // this list is the same set the count on the card came from.
        const res = await tripsApi.getAll({ startDate, page: wanted, limit: PAGE_SIZE });
        setRows(res.data.trips ?? []);
        setTotal(res.data.pagination?.total ?? 0);
        setPage(wanted);
      } catch (error) {
        console.error('Failed to fetch trips for the stat detail', error);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [startDate]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  if (loading) return <Spinner />;
  if (failed) return <Failed onRetry={() => load(page)} />;
  if (rows.length === 0) return <Centered>No trips in this period.</Centered>;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <table className="w-full">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            {['Trip', 'Driver', 'Vehicle', 'Start', 'Duration', 'Mileage', 'Status'].map((head) => (
              <th
                key={head}
                className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((trip) => (
            <tr key={trip.id} className="hover:bg-gray-50">
              <td className="px-5 py-3 text-sm font-medium text-gray-900">#{trip.id}</td>
              <td className="px-5 py-3 text-sm text-gray-600">
                {trip.driver?.name ?? '—'}
                {trip.driver?.employeeId && (
                  <span className="block text-xs text-gray-400">{trip.driver.employeeId}</span>
                )}
              </td>
              <td className="px-5 py-3 text-sm text-gray-600">{trip.vehicle?.plateNumber ?? '—'}</td>
              <td className="px-5 py-3 text-sm text-gray-600">
                {new Date(trip.startTime).toLocaleString()}
              </td>
              <td className="px-5 py-3 text-sm text-gray-600">
                {trip.durationMinutes ? `${trip.durationMinutes} min` : '—'}
              </td>
              <td className="px-5 py-3 text-sm text-gray-600">
                {trip.totalMileage ? `${trip.totalMileage} mi` : '—'}
              </td>
              <td className="px-5 py-3">
                <Badge status={trip.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* A month can run to hundreds of trips, so the list pages rather than
          pretending the first ten are all of them. */}
      <div className="px-5 py-3 flex items-center justify-between border-t border-gray-100 text-sm">
        <span className="text-gray-500">
          {total} trip{total !== 1 ? 's' : ''} · page {page} of {pages}
        </span>
        <span className="space-x-2">
          <button
            type="button"
            onClick={() => load(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => load(page + 1)}
            disabled={page >= pages}
            className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
          >
            Next
          </button>
        </span>
      </div>
    </div>
  );
}

/** The active drivers or vehicles behind one of the roster cards. */
export function RosterDetail({ kind }: { kind: 'drivers' | 'vehicles' }) {
  const [drivers, setDrivers] = useState<PersonRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      // status: 'active' matches what the card counted; the ratio's
      // denominator is the whole roster, which the Drivers and Vehicles pages
      // already list in full.
      if (kind === 'drivers') {
        const res = await driversApi.getAll({ status: 'active' });
        setDrivers(res.data ?? []);
      } else {
        const res = await vehiclesApi.getAll({ status: 'active' });
        setVehicles(res.data ?? []);
      }
    } catch (error) {
      console.error(`Failed to fetch active ${kind} for the stat detail`, error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner />;
  if (failed) return <Failed onRetry={load} />;

  if (kind === 'drivers') {
    if (drivers.length === 0) return <Centered>No active drivers.</Centered>;
    return (
      <table className="w-full">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            {['Driver', 'Employee ID', 'Contact', 'Status'].map((head) => (
              <th
                key={head}
                className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {drivers.map((driver) => (
            <tr key={driver.id} className="hover:bg-gray-50">
              <td className="px-5 py-3 text-sm font-medium text-gray-900">{driver.name}</td>
              <td className="px-5 py-3 text-sm text-gray-600">{driver.employeeId ?? '—'}</td>
              <td className="px-5 py-3 text-sm text-gray-600">
                {driver.phone ?? driver.email ?? '—'}
              </td>
              <td className="px-5 py-3">
                <Badge status={driver.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (vehicles.length === 0) return <Centered>No active vehicles.</Centered>;
  return (
    <table className="w-full">
      <thead className="bg-gray-50 sticky top-0">
        <tr>
          {['Plate', 'Vehicle', 'Odometer', 'Status'].map((head) => (
            <th
              key={head}
              className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {vehicles.map((vehicle) => (
          <tr key={vehicle.id} className="hover:bg-gray-50">
            <td className="px-5 py-3 text-sm font-medium text-gray-900">{vehicle.plateNumber}</td>
            <td className="px-5 py-3 text-sm text-gray-600">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
            </td>
            <td className="px-5 py-3 text-sm text-gray-600">
              {vehicle.currentOdometer != null ? `${vehicle.currentOdometer} mi` : '—'}
            </td>
            <td className="px-5 py-3">
              <Badge status={vehicle.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
