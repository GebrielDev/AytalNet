import { Router } from 'express';
import { readPhoto } from '../config/photoStorage';

const router = Router();

/**
 * Serves trip photographs kept in Emergent storage. Unauthenticated on
 * purpose, like the Cloudinary URLs it replaces: the dashboard shows them in
 * plain <img> tags, which cannot send a bearer token. The random UUID in the
 * path is what keeps them private.
 */
router.get(/^\/(sts-fleet\/trips\/[^/]+)$/, async (req, res) => {
  try {
    const photo = await readPhoto((req.params as unknown as string[])[0]);
    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    res.set('Content-Type', photo.contentType);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(photo.data);
  } catch (error) {
    console.error('[files] Could not read photo', error);
    res.status(502).json({ error: 'Photo could not be loaded' });
  }
});

export default router;
