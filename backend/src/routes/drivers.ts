import { Router } from 'express';
import { getAllDrivers, getDriverById, createDriver, updateDriver, deleteDriver, assignVehicle, getMyAssignedVehicle, setDriverDestination, getMyDestination, setDriverStops, getDriverStops, getMyStops, arriveAtStop, getStopsBoard, updateMyLocation, correctStopOdometer } from '../controllers/driverController';
import { sendDriverNote, getDriverNotes, getMyNotes, markMyNoteRead, replyToMyNote } from '../controllers/notesController';
import { authenticateToken, requireUser, requireDriver } from '../middleware/auth';
import multer from 'multer';

// Optional odometer photo sent with an arrival.
const arrivalPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)),
}).single('photo');

const router = Router();

// Driver-facing route (get my assigned vehicle)
router.get('/my-vehicle', authenticateToken, requireDriver, getMyAssignedVehicle);
router.get('/my-destination', authenticateToken, requireDriver, getMyDestination);
router.get('/my-stops', authenticateToken, requireDriver, getMyStops);
router.post('/my-location', authenticateToken, requireDriver, updateMyLocation);
router.post('/my-stops/:stopId/arrive', authenticateToken, requireDriver, arrivalPhoto, arriveAtStop);
router.get('/my-notes', authenticateToken, requireDriver, getMyNotes);
router.post('/my-notes/:noteId/read', authenticateToken, requireDriver, markMyNoteRead);
router.post('/my-notes/:noteId/reply', authenticateToken, requireDriver, replyToMyNote);

router.use(authenticateToken, requireUser);

router.get('/', getAllDrivers);
router.get('/stops-board', getStopsBoard);
router.get('/:id', getDriverById);
router.post('/', createDriver);
router.put('/:id', updateDriver);
router.put('/:id/assign-vehicle', assignVehicle);
router.put('/:id/destination', setDriverDestination);
router.get('/:id/stops', getDriverStops);
router.put('/:id/stops', setDriverStops);
router.put('/:id/stops/:stopId/odometer', correctStopOdometer);
router.get('/:id/notes', getDriverNotes);
router.post('/:id/notes', sendDriverNote);
router.delete('/:id', deleteDriver);

export default router;
