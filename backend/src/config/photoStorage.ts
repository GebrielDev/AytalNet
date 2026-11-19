import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Emergent managed object storage for trip photographs.
 *
 * Switched on with PHOTO_STORAGE=emergent (and EMERGENT_LLM_KEY). Without it
 * the API keeps using Cloudinary, so the switch is a deliberate deploy-time
 * choice rather than something a missing variable can flip.
 *
 * Objects are private to this backend: the storage service has no public URLs,
 * so each photo is served through GET /api/files/<path>. The path carries a
 * random UUID, which is the same protection a Cloudinary URL gave - whoever
 * holds the link can see the image, nobody can guess one.
 *
 * There is no delete call in the storage API. Erasing a photograph (retention,
 * or a start that failed after its uploads) overwrites the object with zero
 * bytes, which destroys the image while leaving an empty placeholder behind.
 */

const STORAGE_URL =
  ((process.env.INTEGRATION_PROXY_URL || '').trim() || 'https://integrations.emergentagent.com').replace(/\/+$/, '') +
  '/objstore/api/v1/storage';

// Separates this app's objects from any other app on the same Emergent account.
const APP_PREFIX = 'sts-fleet/trips';

const OBJECT_PATH = /^sts-fleet\/trips\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export const usesEmergentStorage = (): boolean => process.env.PHOTO_STORAGE === 'emergent';

let storageKey: string | null = null;

const initStorage = async (): Promise<string> => {
  if (storageKey) return storageKey;
  const emergentKey = process.env.EMERGENT_LLM_KEY;
  if (!emergentKey) throw new Error('EMERGENT_LLM_KEY is not set');
  const res = await fetch(`${STORAGE_URL}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emergent_key: emergentKey }),
  });
  if (!res.ok) throw new Error(`Photo storage init failed (${res.status})`);
  storageKey = ((await res.json()) as { storage_key: string }).storage_key;
  return storageKey;
};

// A stale storage key answers 503: re-initialise once, then give up.
const objectRequest = async (path: string, init: RequestInit): Promise<Response> => {
  for (let attempt = 0; ; attempt++) {
    const key = await initStorage();
    const res = await fetch(`${STORAGE_URL}/objects/${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'X-Storage-Key': key },
    });
    if (res.status === 503 && attempt === 0) {
      storageKey = null;
      continue;
    }
    return res;
  }
};

const putObject = async (path: string, data: Buffer, contentType: string): Promise<void> => {
  const res = await objectRequest(path, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
};

const extensionFor = (mimetype: string): string =>
  mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';

/**
 * The public base of this API, e.g. https://api.example.com/api. PUBLIC_API_URL
 * wins; otherwise it is derived from the request, honouring the proxy's
 * forwarded protocol so a Railway deployment does not hand out http:// links.
 */
export const publicApiBase = (req: Request): string => {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL.replace(/\/+$/, '');
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${forwarded || req.protocol}://${req.get('host')}/api`;
};

/** Stores one photo and returns the URL the API and dashboard use for it. */
export const storePhotoInEmergent = (
  file: Express.Multer.File,
  req: Request
): Promise<{ photoUrl: string; objectPath: string }> => storePhotoBuffer(file.buffer, file.mimetype, publicApiBase(req));

/** Same, for callers without a request (the photo migration script). */
export const storePhotoBuffer = async (
  data: Buffer,
  mimetype: string,
  apiBase: string
): Promise<{ photoUrl: string; objectPath: string }> => {
  const objectPath = `${APP_PREFIX}/${uuidv4()}.${extensionFor(mimetype)}`;
  await putObject(objectPath, data, mimetype);
  return { photoUrl: `${apiBase.replace(/\/+$/, '')}/files/${objectPath}`, objectPath };
};

/** The object path inside a photo URL this module produced, or null. */
export const emergentObjectPath = (photoUrl: string): string | null => {
  const match = /\/files\/(sts-fleet\/trips\/[^?#]+)$/.exec(photoUrl.split('?')[0]);
  return match && OBJECT_PATH.test(match[1]) ? match[1] : null;
};

/** Destroys a photograph's content by overwriting it with nothing. */
export const erasePhoto = async (objectPath: string): Promise<void> => {
  await putObject(objectPath, Buffer.alloc(0), 'application/octet-stream');
};

/** Reads a photo for GET /api/files. Null when it is unknown or erased. */
export const readPhoto = async (
  objectPath: string
): Promise<{ data: Buffer; contentType: string } | null> => {
  if (!OBJECT_PATH.test(objectPath)) return null;
  const res = await objectRequest(objectPath, { method: 'GET' });
  // A missing object comes back as 500, not 404.
  if (!res.ok) return null;
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0) return null;
  return { data, contentType: res.headers.get('content-type') || 'image/jpeg' };
};
