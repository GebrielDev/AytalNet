import { useEffect, useMemo, useState } from 'react';
import { MapContainer, CircleMarker, Popup, useMap } from 'react-leaflet';
import MapTiles from '../components/MapTiles';
import 'leaflet/dist/leaflet.css';
import { tripsApi } from '../services/api';

interface OfflinePoint {
  tripId: number;
  driver: string | null;
  plate: string | null;
  part: 'start' | 'end';
  at: string;
  minutesLate: number;
  latitude: number;
  longitude: number;
}

const formatLate = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d`);

// Fits the map to the points whenever they change.
function FitToPoints({ points }: { points: OfflinePoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40], maxZoom: 13 }
    );
  }, [points, map]);
  return null;
}

/**
 * Where drivers had no signal: each dot is the start or end of a trip that was
 * recorded on the phone and reached the office later. Clusters of dots mark
 * coverage gaps worth knowing about when planning routes.
 */
export default function Coverage() {
  const [points, setPoints] = useState<OfflinePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState({ startDate: '', endDate: '' });

  useEffect(() => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(range).filter(([, v]) => v));
    tripsApi
      .getOfflineLocations(params)
      .then((res) => {
        setPoints(res.data);
        setError('');
      })
      .catch(() => setError('Could not load the coverage data.'))
      .finally(() => setLoading(false));
  }, [range]);

  // A spreadsheet for clients: opens in Excel, Numbers or Google Sheets.
  const exportCsv = () => {
    // Text starting with = + - @ is prefixed so a spreadsheet never runs it as a formula.
    const cell = (v: unknown) => {
      const text = typeof v === 'number' ? String(v) : String(v ?? '').replace(/^([=+\-@])/, "'$1");
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['Trip', 'Driver', 'Vehicle', 'Part', 'Recorded at', 'Minutes until it reached the office', 'Latitude', 'Longitude', 'Map link'],
      ...points.map((p) => [
        p.tripId, p.driver, p.plate, p.part === 'start' ? 'Start' : 'End', new Date(p.at).toLocaleString(), p.minutesLate,
        p.latitude, p.longitude, `https://www.google.com/maps?q=${p.latitude},${p.longitude}`,
      ]),
    ];
    // BOM so Excel reads the file as UTF-8 (driver names with accents).
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `no-signal-locations${range.startDate ? '-from-' + range.startDate : ''}${range.endDate ? '-to-' + range.endDate : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const tripCount = useMemo(() => new Set(points.map((p) => p.tripId)).size, [points]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Signal Coverage</h1>
        <p className="text-sm text-gray-500 mt-1">Where trips were recorded without signal and sent to the office later</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input data-testid="coverage-from" type="date" value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input data-testid="coverage-to" type="date" value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" />
        </div>
        <button
          data-testid="coverage-export-button"
          onClick={exportCsv}
          disabled={loading || points.length === 0}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40"
        >
          Download spreadsheet
        </button>
        <p className="text-sm text-gray-600 px-2 py-2" data-testid="coverage-summary">
          {loading ? 'Loading…' : `${points.length} no-signal point${points.length === 1 ? '' : 's'} from ${tripCount} trip${tripCount === 1 ? '' : 's'}`}
        </p>
      </div>

      {error && <p className="text-sm text-red-600" data-testid="coverage-error">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-testid="coverage-map">
        <MapContainer center={[33.45, -112.07]} zoom={9} style={{ height: 520, width: '100%' }} scrollWheelZoom>
          <MapTiles />
          <FitToPoints points={points} />
          {points.map((p) => (
            <CircleMarker
              key={`${p.tripId}-${p.part}`}
              center={[p.latitude, p.longitude]}
              radius={9}
              pathOptions={{ color: p.part === 'start' ? '#d97706' : '#dc2626', fillOpacity: 0.55 }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">Trip #{p.tripId} · {p.part === 'start' ? 'Start' : 'End'}</p>
                  <p>{p.driver ?? 'Driver'} · {p.plate ?? ''}</p>
                  <p>{new Date(p.at).toLocaleString()}</p>
                  <p>Reached the office {formatLate(p.minutesLate)} later</p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Trip start recorded offline</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-600 inline-block" /> Trip end recorded offline</span>
      </div>
    </div>
  );
}
