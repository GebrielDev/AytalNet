import { Router } from 'express';
import { readPhoto } from '../config/photoStorage';
import { Op } from 'sequelize';
import { authenticateToken } from '../middleware/auth';
import { Trip, TripPhoto, DriverStop } from '../models';

const router = Router();

/**
 * Serves trip photographs kept in Emergent storage - to signed-in dashboard
 * users only. Driver selfies and passenger photos are personal data, so a
 * leaked or forwarded link shows nothing without a dispatcher's session. The
 * dashboard fetches these with its bearer token (see AuthImage) rather than
 * pointing an <img> straight at them.
 */
// A driver may open only photos from their own trips and stops.
const driverOwns = async (driverId: number, objectPath: string): Promise<boolean> => {
  const like = { [Op.like]: `%/files/${objectPath}` };
  const trip = await TripPhoto.findOne({ where: { photoUrl: like }, include: [{ model: Trip, as: 'trip', where: { driverId }, attributes: [] }], attributes: ['id'] });
  if (trip) return true;
  return !!(await DriverStop.findOne({ where: { driverId, arrivedPhotoUrl: like }, attributes: ['id'] }));
};

router.get(/^\/(sts-fleet\/trips\/[^/]+)$/, authenticateToken, async (req, res) => {
  try {
    const objectPath = (req.params as unknown as string[])[0];
    if (!req.user && !(req.driver && (await driverOwns(req.driver.id, objectPath)))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const photo = await readPhoto(objectPath);
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
