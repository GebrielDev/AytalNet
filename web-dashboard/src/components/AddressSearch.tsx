import { useEffect, useRef, useState } from 'react';
import { geoApi } from '../services/api';

export interface AddressPick {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * An address box that suggests matching places as the dispatcher types.
 * Picking one carries its map position, so the stop is always found on the
 * map. Typing without picking still works; the server looks it up on save.
 */
export default function AddressSearch({
  value,
  onChange,
  testId,
  placeholder = 'Start typing an address or place',
}: {
  value: AddressPick;
  onChange: (pick: AddressPick) => void;
  testId: string;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<{ label: string; latitude: number; longitude: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const q = value.address.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    // Waits for a pause in typing, so a word is one request, not one per key.
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await geoApi.search(q);
        if (!cancelled) {
          setSuggestions(res.data);
          setUnavailable(false);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value.address]);

  return (
    <div className="relative">
      <input
        data-testid={testId}
        value={value.address}
        onChange={(e) => {
          typed.current = true;
          onChange({ address: e.target.value, latitude: null, longitude: null });
        }}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="mt-1 text-xs h-4">
        {searching ? (
          <span className="text-gray-400">Searching…</span>
        ) : value.address.trim() && value.latitude != null ? (
          <span className="text-green-700" data-testid={`${testId}-on-map`}>Found on the map</span>
        ) : unavailable ? (
          <span className="text-gray-400">Suggestions unavailable, the address is looked up when you save</span>
        ) : null}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 top-10 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden" data-testid={`${testId}-suggestions`}>
          {suggestions.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                data-testid={`${testId}-suggestion-${i}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  onChange({ address: s.label, latitude: s.latitude, longitude: s.longitude });
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
