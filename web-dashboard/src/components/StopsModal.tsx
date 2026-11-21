import { useEffect, useState } from 'react';
import { driversApi } from '../services/api';
import AddressSearch, { type AddressPick } from './AddressSearch';
import AuthImage from './AuthImage';

interface Stop {
  id?: number;
  address: string;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  arrivedAt?: string | null;
  arrivedDistanceMeters?: number | null;
  arrivedOdometer?: number | null;
  arrivedPhotoUrl?: string | null;
}

type Draft = AddressPick & { key: string; note: string; id?: number };

const newDraft = (): Draft => ({ key: Math.random().toString(36).slice(2), address: '', latitude: null, longitude: null, note: '' });

const distanceText = (m: number | null | undefined) => (m == null ? '' : m < 1000 ? ` (${m} m away)` : ` (${(m / 1000).toFixed(1)} km away)`);

/**
 * A driver's job: an ordered list of stops. The driver app shows each with a
 * Navigate button and works through them in order; stops already reached are
 * listed as done.
 */
export default function StopsModal({ driver, onClose, onSaved }: { driver: { id: number; name: string }; onClose: () => void; onSaved: () => void }) {
  const [done, setDone] = useState<Stop[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState<string[]>([]);

  useEffect(() => {
    driversApi
      .getStops(driver.id)
      .then((res) => {
        const stops: Stop[] = res.data;
        setDone(stops.filter((s) => s.arrivedAt));
        const pending = stops.filter((s) => !s.arrivedAt);
        setDrafts(pending.length ? pending.map((s) => ({ key: String(s.id), id: s.id, address: s.address, latitude: s.latitude, longitude: s.longitude, note: s.note ?? '' })) : [newDraft()]);
      })
      .catch(() => setError('Could not load the stops'))
      .finally(() => setLoading(false));
  }, [driver.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setDrafts((d) => {
      const next = [...d];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });

  const save = async (clearDone = false) => {
    setSaving(true);
    setError('');
    try {
      const stops = drafts
        .filter((d) => d.address.trim())
        .map((d) => ({ id: d.id, address: d.address, note: d.note, latitude: d.latitude, longitude: d.longitude }));
      const res = await driversApi.setStops(driver.id, stops, clearDone);
      onSaved();
      if (res.data.notFound?.length) {
        setNotFound(res.data.notFound);
        setDone(res.data.stops.filter((s: Stop) => s.arrivedAt));
        return;
      }
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not save the stops');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" data-testid="stops-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-6 pb-3">
          <h2 className="text-lg font-bold text-gray-900">Stops for {driver.name}</h2>
          <p className="text-sm text-gray-500 mt-1">In order. The driver sees each with a Navigate button and an “I've arrived” button.</p>
        </div>

        <div className="px-6 overflow-y-auto space-y-3 flex-1">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}

          {done.map((s, i) => (
            <div key={s.id} className="flex items-start gap-3 text-sm text-gray-500" data-testid={`stops-done-${i}`}>
              <span className="mt-0.5 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
              <span>
                <span className="line-through">{s.address}</span>
                <span className="block text-xs text-green-700">
                  Arrived {s.arrivedAt ? new Date(s.arrivedAt).toLocaleString() : ''}
                  {distanceText(s.arrivedDistanceMeters)}
                </span>
                {s.arrivedOdometer != null && <span className="block text-xs text-gray-700" data-testid={`stops-done-odometer-${i}`}>Odometer {s.arrivedOdometer} mi</span>}
                {s.arrivedPhotoUrl && (
                  <a href="#" onClick={(e) => e.preventDefault()} className="block mt-1">
                    <AuthImage src={s.arrivedPhotoUrl} alt="Odometer at stop" className="w-24 h-24 object-cover rounded-lg border border-gray-200" testId={`stops-done-photo-${i}`} />
                  </a>
                )}
              </span>
            </div>
          ))}

          {drafts.map((d, i) => (
            <div key={d.key} className="border border-gray-200 rounded-xl p-3 space-y-2" data-testid={`stops-row-${i}`}>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">{done.length + i + 1}</span>
                <div className="flex-1">
                  <AddressSearch value={d} onChange={(pick) => update(i, pick)} testId={`stops-address-${i}`} />
                </div>
              </div>
              <div className="flex items-center gap-2 pl-8">
                <input
                  data-testid={`stops-note-${i}`}
                  value={d.note}
                  onChange={(e) => update(i, { note: e.target.value })}
                  placeholder="Note for the driver (optional)"
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-gray-50"
                />
                <button data-testid={`stops-up-${i}`} style={{ minWidth: 36, minHeight: 36 }} disabled={i === 0} onClick={() => move(i, -1)} className="px-2 py-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Move up">↑</button>
                <button data-testid={`stops-down-${i}`} style={{ minWidth: 36, minHeight: 36 }} disabled={i === drafts.length - 1} onClick={() => move(i, 1)} className="px-2 py-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Move down">↓</button>
                <button data-testid={`stops-remove-${i}`} style={{ minWidth: 36, minHeight: 36 }} onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))} className="px-2 py-1 text-red-500 hover:text-red-700" title="Remove">✕</button>
              </div>
            </div>
          ))}

          <button data-testid="stops-add-button" onClick={() => setDrafts((d) => [...d, newDraft()])} className="w-full py-2 text-sm font-medium text-blue-600 border border-dashed border-blue-300 rounded-xl hover:bg-blue-50">
            + Add stop
          </button>

          {notFound.length > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="stops-not-found">
              Saved and sent to the driver, but not found on the map: {notFound.join('; ')}. Pick a suggestion while typing so arrival can be checked.
            </p>
          )}
          {error && <p className="text-sm text-red-600" data-testid="stops-error">{error}</p>}
        </div>

        <div className="flex justify-between gap-2 p-6 pt-4">
          {done.length ? (
            <button data-testid="stops-clear-done-button" disabled={saving} onClick={() => save(true)} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              Clear finished stops
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button data-testid="stops-cancel-button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button data-testid="stops-save-button" disabled={saving || loading} onClick={() => save()} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
              {saving ? 'Saving…' : 'Save stops'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
