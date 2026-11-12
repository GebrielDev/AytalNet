import { Request, Response } from 'express';
import { Trip, TripPhoto, Driver, Vehicle } from '../models';
import { Op } from 'sequelize';
import cloudinary from '../config/cloudinary';

// Upload buffer to Cloudinary. Returns the secure URL and the asset's public
// id, which is what lets a start that fails afterwards delete what it uploaded.
const uploadBufferToCloudinary = (
  buffer: Buffer,
  mimetype: string
): Promise<{ secureUrl: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'fleet-management/trips', resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error || new Error('No result'));
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
};

export const getAllTrips = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, driverId, vehicleId, startDate, endDate, page = 1, limit = 20 } = req.query;
    const where: any = {};

    if (status) where.status = status;
    if (driverId) where.driverId = driverId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime[Op.gte] = new Date(startDate as string);
      if (endDate) where.startTime[Op.lte] = new Date(endDate as string);
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows: trips } = await Trip.findAndCountAll({
      where,
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'employeeId'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'plateNumber', 'make', 'model'] },
        { model: TripPhoto, as: 'photos' },
      ],
      order: [['startTime', 'DESC']],
      limit: Number(limit),
      offset,
    });

    res.json({
      trips,
      pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
};

export const getActiveTrips = async (req: Request, res: Response): Promise<void> => {
  try {
    const trips = await Trip.findAll({
      where: { status: 'in_progress' },
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'employeeId', 'phone'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'plateNumber', 'make', 'model'] },
      ],
      order: [['startTime', 'DESC']],
    });
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active trips' });
  }
};

export const getTripById = async (req: Request, res: Response): Promise<void> => {
  try {
    const trip = await Trip.findByPk(req.params.id, {
      include: [
        { model: Driver, as: 'driver', attributes: { exclude: ['passwordHash'] } },
        { model: Vehicle, as: 'vehicle' },
        { model: TripPhoto, as: 'photos' },
      ],
    });

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    res.json(trip);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
};

/**
 * An odometer reading has to be a real, non-negative number.
 *
 * The driver app requires one on both screens, but client validation is not
 * the guarantee: a trip could be ended through the API with no reading at all,
 * which completed the trip, left total_mileage as NaN and never updated the
 * vehicle's odometer - so the trip silently vanished from mileage reporting.
 * A missing start reading only failed because start_odometer is NOT NULL,
 * surfacing as a 500 rather than telling the caller what was wrong, and a
 * negative reading was accepted outright.
 *
 * Zero is deliberately valid: a new vehicle genuinely starts there.
 */
const isOdometerReading = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The photographs a trip cannot be started without.
 *
 * These used to be enforced only by the driver app, which gated its Start
 * button on them and then uploaded them one at a time AFTER the trip had been
 * created. Any upload that failed - flaky signal, app killed, Cloudinary
 * down - left a trip sitting in_progress with some or none of its photos, the
 * driver looking at "Failed to start trip", and a retry blocked by "You
 * already have an active trip". Nothing reconciled those afterwards.
 *
 * So the photos now arrive with the request that creates the trip, and the
 * trip and its photos are written in one transaction: either a trip exists
 * with its full set of photographs, or it does not exist at all.
 */
export const REQUIRED_START_PHOTOS = [
  'license_plate',
  'driver_selfie',
  'start_odometer',
] as const;

/**
 * Photographs a start accepts but does not insist on. Not every trip carries
 * a passenger, and photographing one needs their knowledge (see the privacy
 * policy), so a start without one is complete. When one is sent it is stored
 * in the same transaction as the trip, exactly like the required ones.
 */
export const OPTIONAL_START_PHOTOS = ['passenger'] as const;

/**
 * Every photo field the start route accepts. The upload middleware is built
 * from this rather than the required list: multer rejects a field it was not
 * told about, so a list without `passenger` would turn every start that does
 * include one - all of driver-app build 8's - into an error.
 */
export const START_PHOTO_FIELDS = [...REQUIRED_START_PHOTOS, ...OPTIONAL_START_PHOTOS] as const;

type StartPhoto = (typeof START_PHOTO_FIELDS)[number];

/**
 * Stores one photo buffer and returns its URL, preferring Cloudinary and
 * falling back to a base64 data URI so a trip can still start when Cloudinary
 * is unreachable. Mirrors uploadTripPhoto, which does the same for end_odometer.
 */
const storePhoto = async (
  file: Express.Multer.File
): Promise<{ photoUrl: string; publicId: string | null }> => {
  try {
    const { secureUrl, publicId } = await uploadBufferToCloudinary(file.buffer, file.mimetype);
    return { photoUrl: secureUrl, publicId };
  } catch (_cloudErr) {
    // The data URI lives in the photo row itself, so there is nothing remote
    // to clean up for one of these - hence the null id rather than a throw.
    return {
      photoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      publicId: null,
    };
  }
};

/**
 * Deletes the Cloudinary assets uploaded for a start that then failed.
 *
 * Rolling the transaction back only undoes the database. Left alone, the
 * images stay in Cloudinary with no trip_photos row pointing at them, and the
 * retention job walks that table - so a driver selfie or passenger photograph
 * would sit there permanently, outside the seven-year window the policy gives
 * it, with nothing left that could ever find it again.
 *
 * Best effort on purpose: the request is already failing for a reason worth
 * reporting, and a cleanup error must not replace it with a different one.
 */
const discardStoredPhotos = async (stored: { publicId: string | null }[]): Promise<void> => {
  const publicIds = stored
    .map(({ publicId }) => publicId)
    .filter((publicId): publicId is string => Boolean(publicId));

  await Promise.all(
    publicIds.map(async (publicId) => {
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (destroyErr) {
        console.error('[trips] Could not remove orphaned photo', publicId, destroyErr);
      }
    })
  );
};

export const startTrip = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = req.driver!;

    /**
     * The scalars travel as one JSON field rather than as separate multipart
     * fields because multipart turns every value into a string, and the
     * validation below deliberately rejects strings: a reading of '1000' and
     * an unparseable 'abc' are indistinguishable once coerced, and the latter
     * used to reach the API as null. JSON.parse keeps the types the app sent.
     */
    let parsed: unknown;
    try {
      const raw = (req.body ?? {}).payload;
      parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? req.body ?? {});
    } catch (_parseErr) {
      res.status(400).json({ error: 'Trip details were not valid JSON' });
      return;
    }

    // `null` is valid JSON, and destructuring it throws - which came back as a
    // 500 rather than telling the caller what was wrong with their request.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      res.status(400).json({ error: 'Trip details were not valid JSON' });
      return;
    }

    const payload = parsed as Record<string, unknown>;

    const { vehicleId, startOdometer, startLatitude, startLongitude, startAddress } = payload as {
      vehicleId?: number;
      startOdometer?: unknown;
      startLatitude?: unknown;
      startLongitude?: unknown;
      startAddress?: string;
    };

    // start_latitude and start_longitude became nullable so the retention job
    // can strip the location from trips past their seven-year window. That
    // relaxed the only thing stopping a live trip being created without one,
    // so the check the NOT NULL used to perform now has to happen here.
    const isCoordinate = (value: unknown, limit: number): value is number =>
      typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

    if (!isCoordinate(startLatitude, 90) || !isCoordinate(startLongitude, 180)) {
      res.status(400).json({ error: 'A valid start latitude and longitude are required' });
      return;
    }

    if (!isOdometerReading(startOdometer)) {
      res.status(400).json({ error: 'A valid start odometer reading is required' });
      return;
    }

    // Checked before any upload or write, so a request missing a photograph
    // costs nothing and creates nothing.
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const photos: { photoType: StartPhoto; file: Express.Multer.File }[] = [];
    const missing: string[] = [];

    for (const photoType of REQUIRED_START_PHOTOS) {
      const file = files[photoType]?.[0];
      if (!file || !file.buffer?.length) {
        missing.push(photoType);
      } else {
        photos.push({ photoType, file });
      }
    }

    // An optional photo that arrives empty is treated as not sent rather than
    // rejected: it adds nothing, and it is no reason to refuse the trip.
    for (const photoType of OPTIONAL_START_PHOTOS) {
      const file = files[photoType]?.[0];
      if (file?.buffer?.length) {
        photos.push({ photoType, file });
      }
    }

    if (missing.length > 0) {
      res.status(400).json({
        error: `A trip cannot be started without these photographs: ${missing.join(', ')}`,
        missingPhotos: missing,
      });
      return;
    }

    const existingTrip = await Trip.findOne({ where: { driverId: driver.id, status: 'in_progress' } });
    if (existingTrip) {
      res.status(400).json({ error: 'You already have an active trip' });
      return;
    }

    const vehicleTrip = await Trip.findOne({ where: { vehicleId, status: 'in_progress' } });
    if (vehicleTrip) {
      res.status(400).json({ error: 'Vehicle is currently in use' });
      return;
    }

    const vehicle = await Vehicle.findByPk(vehicleId);
    if (!vehicle || vehicle.status !== 'active') {
      res.status(400).json({ error: 'Vehicle not available' });
      return;
    }

    // Stored before the transaction opens: these are network calls to
    // Cloudinary and holding a database transaction across them would pin a
    // connection for their duration. A failure here has written nothing.
    const takenAt = new Date();
    const results = await Promise.allSettled(
      photos.map(async ({ photoType, file }) => ({
        photoType,
        ...(await storePhoto(file)),
      }))
    );

    const storedPhotos = results
      .filter(
        (r): r is PromiseFulfilledResult<{
          photoType: StartPhoto;
          photoUrl: string;
          publicId: string | null;
        }> => r.status === 'fulfilled'
      )
      .map((r) => r.value);

    // allSettled rather than all: Promise.all rejects on the first failure
    // while the others keep going, so whatever they uploaded would be stranded
    // in Cloudinary with nothing to point at it.
    if (storedPhotos.length !== photos.length) {
      await discardStoredPhotos(storedPhotos);
      res.status(502).json({ error: 'Could not store the trip photographs. No trip was started.' });
      return;
    }

    // One transaction, so a trip never exists without its photographs. If the
    // photo rows fail, the trip is rolled back and the driver can simply retry
    // rather than being locked out by an active trip they cannot see.
    //
    // Model.init always sets this; the guard is here so that if it is ever
    // absent the request fails having written nothing, rather than quietly
    // falling back to the unpaired writes this change exists to remove.
    const sequelize = Trip.sequelize;
    if (!sequelize) {
      await discardStoredPhotos(storedPhotos);
      res.status(500).json({ error: 'Failed to start trip' });
      return;
    }

    // Opening the transaction is inside the try: it can fail too, and the
    // photos are already uploaded by this point.
    let tripId: number | undefined;
    let createdTripId: number | undefined;
    let commitAttempted = false;
    let transaction: Awaited<ReturnType<typeof sequelize.transaction>> | undefined;
    try {
      transaction = await sequelize.transaction();

      const trip = await Trip.create(
        {
          driverId: driver.id,
          // vehicle.id rather than the payload's vehicleId: the lookup above
          // has already proved this one exists and is active.
          vehicleId: vehicle.id,
          startTime: takenAt,
          startOdometer,
          startLatitude,
          startLongitude,
          startAddress,
        },
        { transaction }
      );
      createdTripId = trip.id;

      await TripPhoto.bulkCreate(
        storedPhotos.map(({ photoType, photoUrl }) => ({
          tripId: trip.id,
          photoType,
          photoUrl,
          takenAt,
        })),
        { transaction }
      );

      commitAttempted = true;
      await transaction.commit();
      tripId = trip.id;
    } catch (writeErr) {
      // try/catch rather than .catch(): a rollback that throws synchronously
      // would otherwise escape this block and skip the cleanup below - and a
      // rollback is most likely to misbehave precisely when the write just
      // failed because the connection is gone. The original error is the one
      // worth reporting, so a rollback problem is only logged.
      if (transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackErr) {
          console.error('[trips] Rollback failed after a failed start', rollbackErr);
        }
      }
      /**
       * A failed commit is an unknown outcome, not a failure. PostgreSQL can
       * execute COMMIT and the connection drop before the confirmation
       * arrives, so commit() rejects while the trip and its photo rows are
       * durable. Deleting the images then would leave a live trip whose
       * required photographs are gone - worse than the orphaning the cleanup
       * exists to prevent. So ask the database which happened, on a fresh
       * read outside the dead transaction.
       */
      let outcome: 'committed' | 'not-committed' | 'unknown' = 'not-committed';
      if (commitAttempted && createdTripId !== undefined) {
        try {
          outcome = (await Trip.findByPk(createdTripId)) ? 'committed' : 'not-committed';
        } catch (lookupErr) {
          outcome = 'unknown';
          console.error('[trips] Could not confirm whether a failed commit landed', lookupErr);
        }
      }

      if (outcome === 'committed') {
        // The trip is real: carry on to the normal response below.
        console.error('[trips] Commit reported an error but the trip is durable', writeErr);
        tripId = createdTripId;
      } else {
        // Only delete when the database has confirmed nothing points at the
        // images. When it cannot say, keep them: a possible orphan is
        // recoverable, a live trip's deleted evidence is not.
        if (outcome === 'not-committed') {
          await discardStoredPhotos(storedPhotos);
        }
        console.error('[trips] Start failed after photos were stored', writeErr);
        res.status(500).json({ error: 'Failed to start trip' });
        return;
      }
    }

    // 'phone' matches getActiveTrips. The dashboard shows a Phone column for
    // every active trip, so without it a trip that arrives over the socket
    // renders a blank cell until the page is reloaded and the REST fetch -
    // which does include it - fills the gap.
    const fullTrip = await Trip.findByPk(tripId!, {
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'employeeId', 'phone'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'plateNumber', 'make', 'model'] },
      ],
    });

    const io = req.app.get('io');
    if (io) {
      io.to('dashboard').emit('trip:started', fullTrip);
    }

    res.status(201).json(fullTrip);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start trip' });
  }
};

export const endTrip = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = req.driver!;
    // `?? {}` mirrors startTrip. express.json() already defaults req.body to
    // an object, so this is not load-bearing today - it keeps the guard below
    // working if this route is ever mounted without that parser.
    const { endOdometer, endLatitude, endLongitude, endAddress } = req.body ?? {};

    const trip = await Trip.findOne({ where: { id: req.params.id, driverId: driver.id, status: 'in_progress' } });
    if (!trip) {
      res.status(404).json({ error: 'Active trip not found' });
      return;
    }

    // Before the comparison below: an absent reading is not "less than start",
    // so it slipped through and completed the trip with no mileage.
    if (!isOdometerReading(endOdometer)) {
      res.status(400).json({ error: 'A valid end odometer reading is required' });
      return;
    }

    if (endOdometer < Number(trip.startOdometer)) {
      res.status(400).json({ error: 'End odometer cannot be less than start' });
      return;
    }

    const endTime = new Date();
    const durationMinutes = Math.round((endTime.getTime() - trip.startTime.getTime()) / 60000);
    const totalMileage = endOdometer - Number(trip.startOdometer);

    await trip.update({ status: 'completed', endTime, durationMinutes, endOdometer, totalMileage, endLatitude, endLongitude, endAddress });
    await Vehicle.update({ currentOdometer: endOdometer }, { where: { id: trip.vehicleId } });

    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('trip:ended', trip);

    res.json(trip);
  } catch (error) {
    res.status(500).json({ error: 'Failed to end trip' });
  }
};

export const uploadTripPhoto = async (req: Request, res: Response): Promise<void> => {
  try {
    const { photoType } = req.body;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No photo uploaded' });
      return;
    }

    const trip = await Trip.findByPk(req.params.id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    let photoUrl: string;
    try {
      // Try Cloudinary upload from memory buffer
      photoUrl = (await uploadBufferToCloudinary(file.buffer, file.mimetype)).secureUrl;
    } catch (_cloudErr) {
      // Fallback: store as base64 data URI (works without any external service)
      const base64 = file.buffer.toString('base64');
      photoUrl = `data:${file.mimetype};base64,${base64}`;
    }

    const photo = await TripPhoto.create({
      tripId: trip.id,
      photoType,
      photoUrl,
      takenAt: new Date(),
    });

    res.status(201).json(photo);
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload photo' });
  }
};

export const getDriverActiveTrip = async (req: Request, res: Response): Promise<void> => {
  try {
    const trip = await Trip.findOne({
      where: { driverId: req.driver!.id, status: 'in_progress' },
      include: [{ model: Vehicle, as: 'vehicle' }, { model: TripPhoto, as: 'photos' }],
    });
    res.json(trip);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active trip' });
  }
};

export const getDriverTrips = async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = req.driver!;
    const trips = await Trip.findAll({
      where: { driverId: driver.id, status: 'completed' },
      include: [
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'plateNumber', 'make', 'model'] },
      ],
      order: [['endTime', 'DESC']],
      limit: 10,
    });
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch driver trips' });
  }
};

export const cancelTrip = async (req: Request, res: Response): Promise<void> => {
  try {
    const trip = await Trip.findByPk(req.params.id);
    if (!trip || trip.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot cancel this trip' });
      return;
    }

    await trip.update({ status: 'cancelled', endTime: new Date() });

    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('trip:cancelled', { id: trip.id });

    res.json({ message: 'Trip cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel trip' });
  }
};
