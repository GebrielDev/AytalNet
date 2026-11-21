import { Request, Response } from 'express';
import { Driver, Trip, Vehicle, DriverStop } from '../models';
import { Op } from 'sequelize';
import { geocodeAddress } from '../services/geo';
import sequelize from '../config/database';
import { listStops, syncDriverStops, markStopArrived, stopView, flagOdometers } from '../services/stops';
import { distanceMeters, arrivalRadiusMeters } from '../services/geo';
import { storePhoto } from './tripController';

export const getAllDrivers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, search } = req.query;
    const where: any = {};

    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { employeeId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const drivers = await Driver.findAll({
      where,
      attributes: { exclude: ['passwordHash'] },
      include: [{ model: Vehicle, as: 'assignedVehicle', attributes: ['id', 'plateNumber', 'make', 'model'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
};

export const getDriverById = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.params.id, { attributes: { exclude: ['passwordHash'] } });
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const tripCount = await Trip.count({ where: { driverId: driver.id } });
    const activeTrip = await Trip.findOne({ where: { driverId: driver.id, status: 'in_progress' } });

    res.json({ ...driver.toJSON(), tripCount, hasActiveTrip: !!activeTrip });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch driver' });
  }
};

export const createDriver = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, name, email, phone, password, licenseNumber } = req.body;

    const existing = await Driver.findOne({ where: { [Op.or]: [{ email }, { employeeId }] } });
    if (existing) {
      res.status(400).json({ error: 'Email or Employee ID already exists' });
      return;
    }

    const driver = await Driver.create({ employeeId, name, email, phone, passwordHash: password, licenseNumber });
    res.status(201).json({
      id: driver.id, employeeId: driver.employeeId, name: driver.name,
      email: driver.email, phone: driver.phone, licenseNumber: driver.licenseNumber,
      status: driver.status, createdAt: driver.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create driver' });
  }
};

export const updateDriver = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.params.id);
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const { name, email, phone, licenseNumber, status, password } = req.body;

    if (email && email !== driver.email) {
      const existing = await Driver.findOne({ where: { email } });
      if (existing) {
        res.status(400).json({ error: 'Email already exists' });
        return;
      }
    }

    await driver.update({
      ...(name && { name }),
      ...(email && { email }),
      ...(phone && { phone }),
      ...(licenseNumber && { licenseNumber }),
      ...(status && { status }),
      ...(password && { passwordHash: password }),
    });

    res.json({ id: driver.id, employeeId: driver.employeeId, name: driver.name, email: driver.email, phone: driver.phone, status: driver.status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update driver' });
  }
};

export const deleteDriver = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.params.id);
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const activeTrip = await Trip.findOne({ where: { driverId: driver.id, status: 'in_progress' } });
    if (activeTrip) {
      res.status(400).json({ error: 'Cannot deactivate driver with active trip' });
      return;
    }

    await driver.update({ status: 'inactive' });
    res.json({ message: 'Driver deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate driver' });
  }
};

export const assignVehicle = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.params.id);
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const { vehicleId } = req.body;

    if (vehicleId) {
      const vehicle = await Vehicle.findByPk(vehicleId);
      if (!vehicle || vehicle.status !== 'active') {
        res.status(400).json({ error: 'Vehicle not available' });
        return;
      }

      // Check if vehicle is already assigned to another driver
      const existingAssignment = await Driver.findOne({
        where: { assignedVehicleId: vehicleId, id: { [Op.ne]: driver.id } },
      });
      if (existingAssignment) {
        res.status(400).json({ error: `Vehicle already assigned to ${existingAssignment.name}` });
        return;
      }
    }

    await driver.update({ assignedVehicleId: vehicleId || null });

    const updated = await Driver.findByPk(driver.id, {
      attributes: { exclude: ['passwordHash'] },
      include: [{ model: Vehicle, as: 'assignedVehicle', attributes: ['id', 'plateNumber', 'make', 'model'] }],
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign vehicle' });
  }
};

export const getMyAssignedVehicle = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.driver!.id, {
      include: [{ model: Vehicle, as: 'assignedVehicle' }],
    });

    if (!driver || !driver.assignedVehicleId) {
      res.json(null);
      return;
    }

    res.json((driver as any).assignedVehicle);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assigned vehicle' });
  }
};

/**
 * Sets, or with an empty address clears, where a driver should go next. The
 * driver app shows it with a Navigate button that opens their maps app.
 */
export const setDriverDestination = async (req: Request, res: Response): Promise<void> => {
  // Kept for older dashboards: one destination is a job with a single stop.
  const { address, note } = req.body ?? {};
  if ((address != null && typeof address !== 'string') || (note != null && typeof note !== 'string')) {
    res.status(400).json({ error: 'Address and note must be text' });
    return;
  }
  req.body = { stops: (address ?? '').trim() ? [{ address, note }] : [] };
  await setDriverStops(req, res);
};

const MAX_STOPS = 25;

/**
 * Replaces the stops still to visit with the list given, in order. Stops
 * already reached stay as a record until the dispatcher clears them
 * (clearDone). Each stop may carry the map position picked from the address
 * search; otherwise it is looked up, and a stop that cannot be found is still
 * saved and navigable but reported back as not found.
 */
export const setDriverStops = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.params.id);
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }
    const { stops, clearDone } = req.body ?? {};
    if (!Array.isArray(stops) || stops.length > MAX_STOPS) {
      res.status(400).json({ error: `Send a list of up to ${MAX_STOPS} stops` });
      return;
    }
    const clean: { id: number | null; address: string; note: string | null; latitude: number | null; longitude: number | null }[] = [];
    for (const raw of stops) {
      const address = typeof raw?.address === 'string' ? raw.address.trim().slice(0, 500) : '';
      if (!address) {
        res.status(400).json({ error: 'Every stop needs an address' });
        return;
      }
      if (raw.note != null && typeof raw.note !== 'string') {
        res.status(400).json({ error: 'Notes must be text' });
        return;
      }
      const lat = Number(raw.latitude);
      const lng = Number(raw.longitude);
      const picked = raw.latitude != null && raw.longitude != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      clean.push({ id: Number.isInteger(raw.id) ? raw.id : null, address, note: (raw.note ?? '').trim().slice(0, 500) || null, latitude: picked ? lat : null, longitude: picked ? lng : null });
    }

    // Positions for addresses typed without picking a suggestion. Reuses a
    // known position for an unchanged address, so reordering costs nothing.
    const known = new Map(
      (await DriverStop.findAll({ where: { driverId: driver.id } }))
        .filter((s) => s.latitude != null)
        .map((s) => [s.address, { latitude: Number(s.latitude), longitude: Number(s.longitude) }])
    );
    for (const stop of clean) {
      if (stop.latitude != null) continue;
      const point = known.get(stop.address) ?? (await geocodeAddress(stop.address));
      if (point) Object.assign(stop, point);
    }

    await sequelize.transaction(async (transaction) => {
      const existing = await DriverStop.findAll({ where: { driverId: driver.id }, transaction });
      const byId = new Map(existing.map((s) => [s.id, s]));
      // A stop the driver reached while the dispatcher had the list open comes
      // back in the save as still pending; it stays reached and is dropped.
      const wanted = clean.filter((s) => !(s.id != null && byId.get(s.id)?.arrivedAt));
      const keep = new Set(wanted.map((s) => s.id).filter((id): id is number => id != null && byId.has(id)));
      await DriverStop.destroy({
        where: clearDone
          ? { driverId: driver.id, id: { [Op.notIn]: [...keep, 0] } }
          : { driverId: driver.id, arrivedAt: null, id: { [Op.notIn]: [...keep, 0] } },
        transaction,
      });
      const done = clearDone ? 0 : existing.filter((s) => s.arrivedAt).length;
      let position = done;
      for (const { id, ...stop } of wanted) {
        position += 1;
        const current = id != null ? byId.get(id) : undefined;
        // Unchanged stops keep their id; edited ones are updated in place.
        if (current) await current.update({ ...stop, position }, { transaction });
        else await DriverStop.create({ ...stop, driverId: driver.id, position }, { transaction });
      }
    });

    const saved = await syncDriverStops(req.app.get('io'), driver.id);
    res.json({ driverId: driver.id, stops: saved, notFound: saved.filter((s) => !s.arrivedAt && s.latitude == null).map((s) => s.address) });
  } catch (error) {
    console.error('[stops] Could not save stops', error);
    res.status(500).json({ error: 'Failed to save stops' });
  }
};

export const getDriverStops = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await listStops(Number(req.params.id)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stops' });
  }
};

export const getMyStops = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await listStops(req.driver!.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stops' });
  }
};

/**
 * The driver taps "I've arrived". Accepted when the phone is within the
 * arrival radius of the stop (or the stop has no map position, in which case
 * the driver's word is recorded without a distance).
 */
export const arriveAtStop = async (req: Request, res: Response): Promise<void> => {
  try {
    const stop = await DriverStop.findOne({ where: { id: req.params.stopId, driverId: req.driver!.id } });
    if (!stop) {
      res.status(404).json({ error: 'Stop not found' });
      return;
    }
    // Optional proof: odometer reading and its photo.
    const rawOdo = req.body?.odometer;
    let odometer: number | null = null;
    if (rawOdo !== undefined && rawOdo !== null && String(rawOdo).trim() !== '') {
      odometer = Number(rawOdo);
      if (!Number.isFinite(odometer) || odometer < 0) {
        res.status(400).json({ error: 'Enter a valid odometer reading' });
        return;
      }
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (stop.arrivedAt) {
      // Sent later from a phone that had no signal: the stop may already be
      // marked (e.g. the trip ended there). Keep the proof if none is saved.
      const update: Record<string, unknown> = {};
      if (odometer != null && stop.arrivedOdometer == null) update.arrivedOdometer = odometer;
      if (file && !stop.arrivedPhotoUrl) update.arrivedPhotoUrl = (await storePhoto(file, req)).photoUrl;
      if (Object.keys(update).length) {
        await stop.update(update);
        req.app.get('io')?.to('dashboard').emit('stops:changed', { driverId: stop.driverId });
      }
      res.json({ stops: await listStops(stop.driverId) });
      return;
    }
    // Stops are visited in the order the dispatcher set.
    const next = await DriverStop.findOne({ where: { driverId: stop.driverId, arrivedAt: null }, order: [['position', 'ASC'], ['id', 'ASC']] });
    if (next && next.id !== stop.id) {
      res.status(400).json({ error: `Arrive at stop ${next.position} (${next.address}) first.` });
      return;
    }
    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Your location is needed to confirm arrival' });
      return;
    }
    let distance: number | null = null;
    if (stop.latitude != null && stop.longitude != null) {
      distance = distanceMeters(lat, lng, Number(stop.latitude), Number(stop.longitude));
      if (distance > arrivalRadiusMeters()) {
        const away = distance < 1000 ? `${distance} m` : `${(distance / 1000).toFixed(1)} km`;
        res.status(400).json({ error: `You are ${away} from this stop. Arrive within ${arrivalRadiusMeters()} m to confirm.`, distanceMeters: distance });
        return;
      }
    }
    // A phone with no signal sends the time the driver actually arrived.
    const sentAt = req.body?.arrivedAt ? new Date(String(req.body.arrivedAt)) : null;
    const now = Date.now();
    const when =
      sentAt && Number.isFinite(sentAt.getTime()) && sentAt.getTime() <= now + 5 * 60000 && sentAt.getTime() >= now - 48 * 3600000
        ? sentAt
        : new Date();
    const photoUrl = file ? (await storePhoto(file, req)).photoUrl : null;
    const active = await Trip.findOne({ where: { driverId: stop.driverId, status: 'in_progress' }, attributes: ['id'] });
    const stops = await markStopArrived(req.app.get('io'), stop, distance, active?.id ?? null, 'driver', { latitude: lat, longitude: lng }, { odometer, photoUrl }, when);
    res.json({ stops });
  } catch (error) {
    console.error('[stops] Could not record arrival', error);
    res.status(500).json({ error: 'Failed to record arrival' });
  }
};

export const getMyDestination = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = await Driver.findByPk(req.driver!.id, {
      attributes: ['destinationAddress', 'destinationNote', 'destinationUpdatedAt'],
    });
    res.json(
      driver?.destinationAddress
        ? { address: driver.destinationAddress, note: driver.destinationNote, updatedAt: driver.destinationUpdatedAt }
        : null
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch destination' });
  }
};

/**
 * Each driver's most recent known position. The app does not track drivers
 * continuously; positions are captured when a trip starts or ends and when a
 * stop is reached, so this is the latest of those, labelled with its source.
 */
const lastKnownLocations = async () => {
  const [trips] = (await sequelize.query(`
    SELECT DISTINCT ON (driver_id) driver_id, status, start_time, start_latitude, start_longitude, end_time, end_latitude, end_longitude
    FROM trips WHERE driver_id IS NOT NULL AND status IN ('in_progress', 'completed')
    ORDER BY driver_id, COALESCE(end_time, start_time) DESC`)) as [any[], unknown];
  const [arrivals] = (await sequelize.query(`
    SELECT DISTINCT ON (driver_id) driver_id, arrived_at, arrived_latitude, arrived_longitude
    FROM driver_stops WHERE arrived_at IS NOT NULL AND arrived_latitude IS NOT NULL
    ORDER BY driver_id, arrived_at DESC`)) as [any[], unknown];

  type Seen = { latitude: number; longitude: number; at: string; source: 'trip_start' | 'trip_end' | 'stop_arrival' | 'live' };
  const seen = new Map<number, Seen>();
  const offer = (driverId: number, p: Seen) => {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return;
    const cur = seen.get(driverId);
    if (!cur || new Date(p.at) > new Date(cur.at)) seen.set(driverId, p);
  };
  for (const t of trips) {
    if (t.status === 'completed' && t.end_latitude != null) {
      offer(t.driver_id, { latitude: Number(t.end_latitude), longitude: Number(t.end_longitude), at: t.end_time, source: 'trip_end' });
    } else if (t.start_latitude != null) {
      offer(t.driver_id, { latitude: Number(t.start_latitude), longitude: Number(t.start_longitude), at: t.start_time, source: 'trip_start' });
    }
  }
  const [live] = (await sequelize.query(`
    SELECT id AS driver_id, last_latitude, last_longitude, last_located_at FROM drivers
    WHERE last_located_at IS NOT NULL AND last_latitude IS NOT NULL`)) as [any[], unknown];
  for (const l of live) {
    offer(l.driver_id, { latitude: Number(l.last_latitude), longitude: Number(l.last_longitude), at: l.last_located_at, source: 'live' });
  }
  for (const a of arrivals) {
    offer(a.driver_id, { latitude: Number(a.arrived_latitude), longitude: Number(a.arrived_longitude), at: a.arrived_at, source: 'stop_arrival' });
  }
  return seen;
};

/**
 * Every active driver's stops and progress, for the dashboard's stops board.
 * Drivers with no stops are included (so the dispatcher can give them some)
 * after those with work in hand.
 */
export const getStopsBoard = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [drivers, stops, active] = await Promise.all([
      Driver.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'employeeId'],
        include: [{ model: Vehicle, as: 'assignedVehicle', attributes: ['id', 'plateNumber'] }],
        order: [['name', 'ASC']],
      }),
      DriverStop.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] }),
      Trip.findAll({ where: { status: 'in_progress' }, attributes: ['id', 'driverId', 'startTime'] }),
    ]);
    const lastSeen = await lastKnownLocations();
    const raw = new Map<number, ReturnType<typeof stopView>[]>();
    for (const stop of stops) {
      const list = raw.get(stop.driverId) ?? [];
      list.push(stopView(stop));
      raw.set(stop.driverId, list);
    }
    const byDriver = new Map(await Promise.all([...raw].map(async ([id, list]) => [id, await flagOdometers(list)] as const)));
    const board = (drivers as any[]).map((d) => {
      const list = byDriver.get(d.id) ?? [];
      const trip = active.find((t) => t.driverId === d.id);
      return {
        driverId: d.id,
        name: d.name,
        employeeId: d.employeeId,
        plate: d.assignedVehicle?.plateNumber ?? null,
        activeTrip: trip ? { id: trip.id, startTime: trip.startTime } : null,
        stops: list,
        lastLocation: lastSeen.get(d.id) ?? null,
        done: list.filter((s) => s.arrivedAt).length,
        odometerFlags: list.filter((s) => s.odometerFlag).length,
        total: list.length,
      };
    });
    board.sort((a, b) => Number(b.total - b.done > 0) - Number(a.total - a.done > 0) || a.name.localeCompare(b.name));
    res.json(board);
  } catch (error) {
    console.error('[stops] Could not build the stops board', error);
    res.status(500).json({ error: 'Failed to load the stops board' });
  }
};

/**
 * Live location while driving. Accepted only during a trip in progress, so a
 * driver is never tracked off duty, and at most every 10 s. Each accepted
 * point is pushed to the dashboard's stops board map at once.
 */
export const updateMyLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    // Numbers only: Number(null) and Number('') are 0, which would put the
    // driver at 0,0 off the coast of Africa.
    const { latitude, longitude } = req.body ?? {};
    const lat = latitude;
    const lng = longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'A valid latitude and longitude are required' });
      return;
    }
    const driver = req.driver!;
    const onTrip = await Trip.count({ where: { driverId: driver.id, status: 'in_progress' } });
    if (!onTrip) {
      res.status(409).json({ error: 'Location is only shared during a trip' });
      return;
    }
    const fresh = await Driver.findByPk(driver.id, { attributes: ['id', 'lastLocatedAt'] });
    if (fresh?.lastLocatedAt && Date.now() - new Date(fresh.lastLocatedAt).getTime() < 10000) {
      res.status(202).json({ accepted: false });
      return;
    }
    const at = new Date();
    await Driver.update({ lastLatitude: lat, lastLongitude: lng, lastLocatedAt: at }, { where: { id: driver.id } });
    req.app.get('io')?.to('dashboard').emit('driver:location', { driverId: driver.id, latitude: lat, longitude: lng, at, source: 'live' });
    res.status(202).json({ accepted: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update location' });
  }
};
