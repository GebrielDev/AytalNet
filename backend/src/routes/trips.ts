import { Router } from 'express';
import { getAllTrips, getActiveTrips, getTripById, startTrip, endTrip, uploadTripPhoto, getDriverActiveTrip, getDriverTrips, cancelTrip, REQUIRED_START_PHOTOS } from '../controllers/tripController';
import { authenticateToken, requireUser, requireDriver } from '../middleware/auth';
import multer from 'multer';

const router = Router();

// Use memory storage so file buffer is available for Cloudinary or base64 fallback
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Starting a trip carries its required photographs in the same request, so the
 * trip and its photos can be written together - see REQUIRED_START_PHOTOS.
 * Images only here: these files are stored as a Cloudinary asset or, when that
 * is unreachable, inlined into photo_url as a base64 data URI, and neither is
 * somewhere to put an arbitrary upload.
 */
const startPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: REQUIRED_START_PHOTOS.length },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
}).fields(REQUIRED_START_PHOTOS.map((name) => ({ name, maxCount: 1 })));

// Driver routes
router.post('/start', authenticateToken, requireDriver, startPhotoUpload, startTrip);
router.put('/:id/end', authenticateToken, requireDriver, endTrip);
router.post('/:id/photos', authenticateToken, requireDriver, upload.single('photo'), uploadTripPhoto);
router.get('/my-active', authenticateToken, requireDriver, getDriverActiveTrip);
router.get('/my-trips', authenticateToken, requireDriver, getDriverTrips);

// Dispatcher routes
router.get('/', authenticateToken, requireUser, getAllTrips);
router.get('/active', authenticateToken, requireUser, getActiveTrips);
router.get('/:id', authenticateToken, getTripById);
router.post('/:id/cancel', authenticateToken, requireUser, cancelTrip);

export default router;
