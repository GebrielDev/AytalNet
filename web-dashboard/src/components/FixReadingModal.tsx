import { useEffect, useState } from 'react';
import { driversApi } from '../services/api';

export interface FixableStop {
  id: number;
  position: number;
  address: string;
  arrivedOdometer?: number | null;
  originalOdometer?: number | null;
  odometerFlag?: string | null;
}

/** Dispatcher corrects a stop's odometer reading; the driver's first entry is kept on record. */
export default function FixReadingModal({ driverId, stop, onClose, onSaved }: { driverId: number; stop: FixableStop; onClose: () => void; onSaved: (stops: any[]) => void }) {
  const [odometer, setOdometer] = useState(String(stop.arrivedOdometer ?? ''));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Capture first so Escape closes only this window, not the stops window under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await driversApi.correctStopOdometer(driverId, stop.id, Number(odometer), reason.trim());
      onSaved(res.data.stops);
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not save the reading');
    } finally {
      setSaving(false);
    }
  };

  const valid = odometer.trim() !== '' && Number.isFinite(Number(odometer)) && Number(odometer) >= 0 && reason.trim() !== '';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4" data-testid="fix-reading-modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Fix odometer reading</h2>
          <p className="text-sm text-gray-500 mt-1">Stop {stop.position} · {stop.address}</p>
        </div>
        {stop.odometerFlag && <p className="text-sm font-semibold text-red-700">⚠ {stop.odometerFlag}</p>}
        <p className="text-sm text-gray-700">
          Driver entered <span className="font-semibold">{stop.originalOdometer ?? stop.arrivedOdometer} mi</span>
          {stop.originalOdometer != null && stop.originalOdometer !== stop.arrivedOdometer && <> · now {stop.arrivedOdometer} mi</>}. The driver's entry is kept for the record.
        </p>
        <label className="block text-sm font-medium text-gray-700">
          Correct reading (mi)
          <input
            data-testid="fix-reading-input"
            type="number"
            min={0}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-900"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Reason
          <input
            data-testid="fix-reading-reason"
            value={reason}
            maxLength={255}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Checked the odometer photo — driver typed 20100 for 20490"
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-900"
          />
        </label>
        {error && <p className="text-sm text-red-600" data-testid="fix-reading-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button data-testid="fix-reading-cancel" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button data-testid="fix-reading-save" disabled={!valid || saving} onClick={save} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
            {saving ? 'Saving…' : 'Save reading'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Corrected from X by Name · reason" shown under a fixed reading. */
export function CorrectionNote({ stop, testId }: { stop: { originalOdometer?: number | null; odometerCorrectedBy?: string | null; odometerCorrectedAt?: string | null; odometerCorrectionReason?: string | null }; testId?: string }) {
  if (stop.originalOdometer == null) return null;
  return (
    <span className="block text-xs text-gray-600" data-testid={testId}>
      ✎ Corrected from {stop.originalOdometer} mi by {stop.odometerCorrectedBy || 'dispatcher'}
      {stop.odometerCorrectedAt ? ` · ${new Date(stop.odometerCorrectedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
      {stop.odometerCorrectionReason ? ` — ${stop.odometerCorrectionReason}` : ''}
    </span>
  );
}
