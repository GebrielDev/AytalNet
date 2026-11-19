import { Router } from 'express';
import { getAllDrivers, getDriverById, createDriver, updateDriver, deleteDriver, assignVehicle, getMyAssignedVehicle, setDriverDestination, getMyDestination, setDriverStops, getDriverStops, getMyStops, arriveAtStop, getStopsBoard } from '../controllers/driverController';
import { authenticateToken, requireUser, requireDriver } from '../middleware/auth';

const router = Router();

// Driver-facing route (get my assigned vehicle)
router.get('/my-vehicle', authenticateToken, requireDriver, getMyAssignedVehicle);
router.get('/my-destination', authenticateToken, requireDriver, getMyDestination);
router.get('/my-stops', authenticateToken, requireDriver, getMyStops);
router.post('/my-stops/:stopId/arrive', authenticateToken, requireDriver, arriveAtStop);

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
router.delete('/:id', deleteDriver);

export default router;
