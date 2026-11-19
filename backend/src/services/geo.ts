/**
 * Looks an address up on the map with OpenStreetMap's Nominatim service, so a
 * trip's end point can be compared with where the driver was sent. Free and
 * keyless; its usage policy asks for a real User-Agent and light use, which a
 * lookup each time a dispatcher saves a destination easily is.
 *
 * Never throws: an address that cannot be found (or a lookup that fails)
 * returns null, the destination is still saved and navigable, and the arrival
 * check simply reports "unknown" for that trip.
 */
export const geocodeAddress = async (address: string): Promise<{ latitude: number; longitude: number } | null> => {
  if (process.env.GEOCODING === 'off') return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const lookup = () =>
      fetch(url, {
        headers: { 'User-Agent': 'STS-Fleet-Management/1.0 (destination arrival check)', 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(6000),
      });
    let res = await lookup();
    // Rate-limited or briefly down: one retry after the policy's 1 s spacing,
    // so a busy moment is not reported to the dispatcher as "not found".
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await lookup();
    }
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    if (!hit) return null;
    const latitude = Number(hit.lat);
    const longitude = Number(hit.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  } catch (error) {
    console.error('[geocode] Address lookup failed', error instanceof Error ? error.message : error);
    return null;
  }
};

/** Straight-line distance in metres between two points (haversine). */
export const distanceMeters = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/** How close the end of a trip must be to count as arriving. Default 300 m. */
export const arrivalRadiusMeters = (): number => Number(process.env.ARRIVAL_RADIUS_METERS) || 300;
