import { Router } from 'express';
import { readPhoto } from '../config/photoStorage';
import { authenticateToken, requireUser } from '../middleware/auth';

const router = Router();

/**
 * Serves trip photographs kept in Emergent storage - to signed-in dashboard
 * users only. Driver selfies and passenger photos are personal data, so a
 * leaked or forwarded link shows nothing without a dispatcher's session. The
 * dashboard fetches these with its bearer token (see AuthImage) rather than
 * pointing an <img> straight at them.
 */
router.get(/^\/(sts-fleet\/trips\/[^/]+)$/, authenticateToken, requireUser, async (req, res) => {
  try {
    const photo = await readPhoto((req.params as unknown as string[])[0]);
    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    res.set('Content-Type', photo.contentType);
    // Private: never kept by a shared cache between users.
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(photo.data);
  } catch (error) {
    console.error('[files] Could not read photo', error);
    res.status(502).json({ error: 'Photo could not be loaded' });
  }
});

export default router;
