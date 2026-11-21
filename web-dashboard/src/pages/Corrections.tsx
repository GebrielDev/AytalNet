import { useEffect, useState } from 'react';
import { driversApi } from '../services/api';

interface Correction {
  id: number;
  driverId: number;
  driverName: string;
  employeeId: string | null;
  tripId: number | null;
  stopPosition: number | null;
  stopAddress: string | null;
  originalOdometer: number;
  previousOdometer: number;
  newOdometer: number;
  reason: string;
  correctedByName: string | null;
  createdAt: string;
}

const RANGES = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
  { days: 0, label: 'All time' },
];

const when = (d: string) => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// Quoted, and text starting with = + - @ is prefixed so spreadsheets don't run it as a formula.
const csvCell = (v: unknown) => {
  const text = typeof v === 'number' ? String(v) : String(v ?? '').replace(/^([=+\-@])/, "'$1");
  return `"${text.replace(/"/g, '""')}"`;
};

/** Every corrected odometer reading: who changed it, when and why. */
export default function Corrections() {
  const [rows, setRows] = useState<Correction[]>([]);
  const [drivers, setDrivers] = useState<{ id: number; name: string }[]>([]);
  const [days, setDays] = useState(90);
  const [driverId, setDriverId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    driversApi.getAll().then((res) => setDrivers(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    // Ignore answers for a filter the user has already changed.
    let current = true;
    setLoading(true);
    setError('');
    driversApi
      .getOdometerCorrections({ days, ...(driverId ? { driverId } : {}) })
      .then((res) => current && setRows(res.data))
      .catch(() => {
        if (!current) return;
        setRows([]);
        setError('Could not load corrections');
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [days, driverId]);

  const download = () => {
    const head = ['Corrected at', 'Driver', 'Employee ID', 'Trip', 'Stop', 'Address', 'Driver entered', 'Changed from', 'Changed to', 'Corrected by', 'Reason'];
    const lines = rows.map((r) =>
      [new Date(r.createdAt).toISOString(), r.driverName, r.employeeId, r.tripId, r.stopPosition, r.stopAddress, r.originalOdometer, r.previousOdometer, r.newOdometer, r.correctedByName, r.reason]
        .map(csvCell)
        .join(',')
    );
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `odometer-corrections-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Odometer corrections</h1>
          <p className="text-sm text-gray-500 mt-1">Every stop reading a dispatcher changed, with the driver's original entry.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select data-testid="corrections-driver-filter" value={driverId} onChange={(e) => setDriverId(e.target.value)} className="min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900">
            <option value="">All drivers</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select data-testid="corrections-range-filter" value={days} onChange={(e) => setDays(Number(e.target.value))} className="min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900">
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>{r.label}</option>
            ))}
          </select>
          <button data-testid="corrections-download" disabled={!rows.length} onClick={download} className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
            Download CSV
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600" data-testid="corrections-error">{error}</p>}
      {rows.length >= 1000 && <p className="text-sm text-amber-700" data-testid="corrections-limit">Showing the newest 1,000 corrections. Narrow the dates or pick a driver to see older ones.</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500" data-testid="corrections-empty">No corrected readings in this period.</p>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm" data-testid="corrections-table">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Driver / stop</th>
                  <th className="px-4 py-3">Reading</th>
                  <th className="px-4 py-3">Changed by</th>
                  <th className="px-4 py-3">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`corrections-row-${r.id}`} className="align-top">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{when(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.driverName}</p>
                      <p className="text-xs text-gray-500">
                        {r.stopPosition != null ? `Stop ${r.stopPosition}` : 'Stop'}
                        {r.tripId != null ? ` · Trip #${r.tripId}` : ''}
                        {r.stopAddress ? ` · ${r.stopAddress}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-gray-500 line-through">{r.previousOdometer}</span>
                      <span className="mx-1 text-gray-500">→</span>
                      <span className="font-semibold text-gray-900">{r.newOdometer} mi</span>
                      {r.originalOdometer !== r.previousOdometer && <p className="text-xs text-gray-500">Driver entered {r.originalOdometer}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.correctedByName || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile cards */}
            <ul className="md:hidden divide-y divide-gray-200">
              {rows.map((r) => (
                <li key={r.id} className="p-4 space-y-1" data-testid={`corrections-card-${r.id}`}>
                  <div className="flex justify-between gap-2">
                    <p className="font-medium text-gray-900">{r.driverName}</p>
                    <p className="text-xs text-gray-500">{when(r.createdAt)}</p>
                  </div>
                  <p className="text-xs text-gray-500">{r.stopPosition != null ? `Stop ${r.stopPosition}` : 'Stop'}{r.tripId != null ? ` · Trip #${r.tripId}` : ''}{r.stopAddress ? ` · ${r.stopAddress}` : ''}</p>
                  <p className="text-sm">
                    <span className="text-gray-500 line-through">{r.previousOdometer}</span> → <span className="font-semibold text-gray-900">{r.newOdometer} mi</span>
                    {r.originalOdometer !== r.previousOdometer && <span className="text-xs text-gray-500"> (driver entered {r.originalOdometer})</span>}
                  </p>
                  <p className="text-sm text-gray-700">“{r.reason}” — {r.correctedByName || 'dispatcher'}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
