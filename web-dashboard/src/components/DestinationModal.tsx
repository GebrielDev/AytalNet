import { useEffect, useState } from 'react';
import { driversApi } from '../services/api';

/**
 * Sets where a driver should go next. The driver app shows the address with a
 * Navigate button that opens Google Maps, Apple Maps or Waze.
 */
export default function DestinationModal({
  driver,
  onClose,
  onSaved,
}: {
  driver: { id: number; name: string; destinationAddress?: string | null; destinationNote?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [address, setAddress] = useState(driver.destinationAddress ?? '');
  const [note, setNote] = useState(driver.destinationNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (clear = false) => {
    setSaving(true);
    setError('');
    try {
      await driversApi.setDestination(driver.id, clear ? '' : address, clear ? '' : note);
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not save the destination');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" data-testid="destination-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Destination for {driver.name}</h2>
          <p className="text-sm text-gray-500 mt-1">Shown in the driver app with a Navigate button.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
          <input
            data-testid="destination-address-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. 2 N Central Ave, Phoenix, AZ"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Note for the driver (optional)</label>
          <input
            data-testid="destination-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Pick up at the north entrance"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-sm text-red-600" data-testid="destination-error">{error}</p>}
        <div className="flex justify-between gap-2 pt-2">
          {driver.destinationAddress ? (
            <button data-testid="destination-clear-button" disabled={saving} onClick={() => save(true)} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg">
              Clear destination
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button
              data-testid="destination-save-button"
              disabled={saving || !address.trim()}
              onClick={() => save()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
