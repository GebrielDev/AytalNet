import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapRow {
  driverId: number;
  name: string;
  plate: string | null;
  activeTrip: { id: number } | null;
  lastLocation: { latitude: number; longitude: number; at: string; source: 'trip_start' | 'trip_end' | 'stop_arrival' | 'live' } | null;
  stops: { id: number; position: number; address: string; latitude: number | null; longitude: number | null; arrivedAt: string | null }[];
}

const SOURCE = { trip_start: 'trip started', trip_end: 'trip ended', stop_arrival: 'reached a stop', live: 'live while driving' };

const when = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
};

// A numbered pin for a driver's next stop (a div icon, so no image assets).
const stopIcon = (n: number) =>
  L.divIcon({
    className: '',
    html: `<div style="background:#2563eb;color:#fff;border:2px solid #fff;border-radius:9999px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font:700 12px sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function Fit({ points, focus }: { points: [number, number][]; focus: [number, number] | null }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (focus) {
      map.setView(focus, Math.max(map.getZoom(), 13));
      return;
    }
    if (!points.length) return;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focus?.[0], focus?.[1], map]);
  return null;
}

/**
 * Beside the stops board: each driver's last known position (blue dot, green
 * when on a trip) and their next stop (numbered pin), joined by a dashed line.
 * Positions come from trip starts, trip ends and stop arrivals; the app does
 * not track drivers continuously, so each dot says when and how it was seen.
 */
export default function BoardMap({ rows, focusDriverId, onSelect }: { rows: MapRow[]; focusDriverId: number | null; onSelect: (id: number) => void }) {
  const items = useMemo(
    () =>
      rows.map((r) => {
        const next = r.stops.find((s) => !s.arrivedAt && s.latitude != null && s.longitude != null) ?? null;
        return { r, next };
      }),
    [rows]
  );

  const points: [number, number][] = [];
  for (const { r, next } of items) {
    if (r.lastLocation) points.push([r.lastLocation.latitude, r.lastLocation.longitude]);
    if (next) points.push([next.latitude!, next.longitude!]);
  }
  const focusRow = items.find((i) => i.r.driverId === focusDriverId);
  const focus: [number, number] | null = focusRow?.r.lastLocation
    ? [focusRow.r.lastLocation.latitude, focusRow.r.lastLocation.longitude]
    : focusRow?.next
      ? [focusRow.next.latitude!, focusRow.next.longitude!]
      : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-testid="board-map">
      <MapContainer center={[33.45, -112.07]} zoom={10} style={{ height: 560, width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit points={points} focus={focus} />
        {items.map(({ r, next }) => (
          <div key={r.driverId}>
            {r.lastLocation && next && (
              <Polyline
                positions={[[r.lastLocation.latitude, r.lastLocation.longitude], [next.latitude!, next.longitude!]]}
                pathOptions={{ color: '#64748b', weight: 2, dashArray: '6 6', opacity: r.driverId === focusDriverId ? 1 : 0.6 }}
              />
            )}
            {r.lastLocation && (
              <CircleMarker
                center={[r.lastLocation.latitude, r.lastLocation.longitude]}
                radius={r.driverId === focusDriverId ? 11 : 8}
                pathOptions={{ color: '#fff', weight: 2, fillColor: r.activeTrip ? '#16a34a' : '#3b82f6', fillOpacity: 1 }}
                eventHandlers={{ click: () => onSelect(r.driverId) }}
              >
                <Tooltip direction="top" offset={[0, -8]} permanent={r.driverId === focusDriverId}>
                  {r.name}
                </Tooltip>
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{r.name}{r.plate ? ` · ${r.plate}` : ''}</p>
                    <p>Last seen {when(r.lastLocation.at)} ({SOURCE[r.lastLocation.source]})</p>
                    <p>{r.activeTrip ? 'On a trip' : 'Not on a trip'}</p>
                    {next ? <p>Next stop: {next.address}</p> : null}
                  </div>
                </Popup>
              </CircleMarker>
            )}
            {next && (
              <Marker position={[next.latitude!, next.longitude!]} icon={stopIcon(next.position)} eventHandlers={{ click: () => onSelect(r.driverId) }}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{r.name}: next stop {next.position}</p>
                    <p>{next.address}</p>
                  </div>
                </Popup>
              </Marker>
            )}
          </div>
        ))}
      </MapContainer>
      <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-600 inline-block" /> On a trip</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Last known location</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold inline-flex items-center justify-center">1</span> Next stop</span>
        <span>Live while a driver has the app open on a trip; otherwise the last trip start, end or stop arrival</span>
      </div>
    </div>
  );
}
