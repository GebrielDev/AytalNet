import { Router } from 'express';
import { authenticateToken, requireUser } from '../middleware/auth';

const router = Router();

/**
 * Address suggestions while a dispatcher types a destination. Uses Photon
 * (photon.komoot.io), an OpenStreetMap search built for search-as-you-type;
 * Nominatim's policy does not allow autocomplete. Each suggestion carries its
 * map position, so a picked address never needs a second lookup.
 *
 * Proxied rather than called from the browser so a short cache spares the
 * free service repeated keystrokes, and the dashboard needs no third-party
 * origin. GEO_BIAS_LAT / GEO_BIAS_LON rank nearby places first (default:
 * Phoenix, AZ).
 */
const cache = new Map<string, { at: number; results: unknown[] }>();
const CACHE_MS = 10 * 60 * 1000;

const label = (p: any): string => {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const first = p.name && p.name !== street ? p.name : '';
  return [first, street, p.city || p.town || p.village, [p.state, p.postcode].filter(Boolean).join(' '), p.countrycode === 'US' ? '' : p.country]
    .filter(Boolean)
    .join(', ');
};

router.get('/search', authenticateToken, requireUser, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  if (q.length < 3) {
    res.json([]);
    return;
  }
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.json(hit.results);
    return;
  }
  try {
    const lat = process.env.GEO_BIAS_LAT || '33.4484';
    const lon = process.env.GEO_BIAS_LON || '-112.074';
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=${lat}&lon=${lon}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'STS-Fleet-Management/1.0 (address search)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`photon ${r.status}`);
    const data = (await r.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: any }[] };
    const seen = new Set<string>();
    const results = (data.features ?? [])
      .map((f) => ({ label: label(f.properties), latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0] }))
      .filter((s) => s.label && !seen.has(s.label) && seen.add(s.label))
      .slice(0, 5);
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), results });
    res.json(results);
  } catch (error) {
    console.error('[geo] Address search failed', error instanceof Error ? error.message : error);
    res.status(502).json({ error: 'Address search is unavailable right now' });
  }
});

export default router;
