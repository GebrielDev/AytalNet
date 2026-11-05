import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';

const tripFindOne = vi.fn();
const tripCreate = vi.fn();
const tripFindByPk = vi.fn();
const vehicleFindByPk = vi.fn();
const photoBulkCreate = vi.fn();
const transaction = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();

vi.mock('../models', () => ({
  Trip: {
    findOne: (...a: unknown[]) => tripFindOne(...a),
    create: (...a: unknown[]) => tripCreate(...a),
    findByPk: (...a: unknown[]) => tripFindByPk(...a),
    findAll: vi.fn(), count: vi.fn(), update: vi.fn(),
    sequelize: { transaction: (...a: unknown[]) => transaction(...a) },
  },
  TripPhoto: { bulkCreate: (...a: unknown[]) => photoBulkCreate(...a) },
  Driver: {},
  Vehicle: { findByPk: (...a: unknown[]) => vehicleFindByPk(...a), update: vi.fn() },
}));
vi.mock('../config/cloudinary', () => ({ default: { uploader: { upload_stream: vi.fn() } } }));

const buildApp = async () => {
  const { startTrip, REQUIRED_START_PHOTOS } = await import('./tripController');
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() }).fields(
    REQUIRED_START_PHOTOS.map((name) => ({ name, maxCount: 1 }))
  );
  const asDriver = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { driver: unknown }).driver = { id: 7 };
    next();
  };
  app.post('/trips/start', asDriver, upload, startTrip);
  return app;
};

const payload = {
  vehicleId: 3, startOdometer: 1000,
  startLatitude: 33.4484, startLongitude: -112.074, startAddress: 'Phoenix',
};

const post = async (attachments: readonly string[]) => {
  let req = request(await buildApp()).post('/trips/start').field('payload', JSON.stringify(payload));
  for (const name of attachments) {
    req = req.attach(name, Buffer.from('fake-jpeg-bytes'), `${name}.jpg`);
  }
  return req;
};

/**
 * A trip used to be created first and its photographs uploaded one at a time
 * afterwards, with only the driver app insisting on them. An upload that failed
 * part way through left a trip in_progress carrying some or none of its photos,
 * and the driver could not retry because they now had an active trip.
 *
 * These cover the API: the photographs are required, and the trip and its
 * photos are written together or not at all.
 */
describe('a trip cannot be started without its photographs', () => {
  let allPhotos: readonly string[];

  beforeEach(async () => {
    ({ REQUIRED_START_PHOTOS: allPhotos } = await import('./tripController'));
    tripFindOne.mockResolvedValue(null);
    vehicleFindByPk.mockResolvedValue({ id: 3, status: 'active' });
    tripCreate.mockResolvedValue({ id: 99 });
    tripFindByPk.mockResolvedValue({ id: 99 });
    photoBulkCreate.mockResolvedValue([]);
    transaction.mockResolvedValue({ commit, rollback });
  });

  it('requires the driver selfie, both odometer and passenger photos', async () => {
    expect(allPhotos).toEqual(['license_plate', 'driver_selfie', 'start_odometer', 'passenger']);
  });

  it('starts the trip when every photograph is present', async () => {
    const res = await post(allPhotos);

    expect(res.status).toBe(201);
    expect(tripCreate).toHaveBeenCalled();
    expect(photoBulkCreate).toHaveBeenCalledTimes(1);

    const rows = photoBulkCreate.mock.calls[0][0] as { photoType: string; photoUrl: string }[];
    expect(rows.map((r) => r.photoType).sort()).toEqual([...allPhotos].sort());
    // Cloudinary is unreachable in tests, so each photo takes the data-URI fallback.
    for (const row of rows) {
      expect(row.photoUrl).toMatch(/^data:image\/jpeg;base64,/);
    }
  });

  it.each([
    'license_plate',
    'driver_selfie',
    'start_odometer',
    'passenger',
  ])('rejects a start with no %s photo, and creates nothing', async (omitted) => {
    const res = await post(allPhotos.filter((name) => name !== omitted));

    expect(res.status).toBe(400);
    expect(res.body.missingPhotos).toEqual([omitted]);
    expect(res.body.error).toContain(omitted);
    expect(tripCreate).not.toHaveBeenCalled();
    expect(photoBulkCreate).not.toHaveBeenCalled();
  });

  it('rejects a start with no photographs at all', async () => {
    const res = await post([]);

    expect(res.status).toBe(400);
    expect(res.body.missingPhotos).toEqual([...allPhotos]);
    expect(tripCreate).not.toHaveBeenCalled();
  });

  // The photos are checked before the vehicle and active-trip lookups, so a
  // request missing one costs no queries either.
  it('checks the photographs before touching the database', async () => {
    await post([]);

    expect(tripFindOne).not.toHaveBeenCalled();
    expect(vehicleFindByPk).not.toHaveBeenCalled();
  });

  it('writes the trip and its photos in one transaction', async () => {
    await post(allPhotos);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    const tripOptions = tripCreate.mock.calls[0][1] as { transaction?: unknown };
    const photoOptions = photoBulkCreate.mock.calls[0][1] as { transaction?: unknown };
    expect(tripOptions.transaction).toBeDefined();
    expect(photoOptions.transaction).toBe(tripOptions.transaction);
  });

  // The failure that used to strand a trip. Now the trip goes back with it.
  it('rolls the trip back when the photo rows fail, so no trip is left behind', async () => {
    photoBulkCreate.mockRejectedValue(new Error('insert failed'));

    const res = await post(allPhotos);

    expect(res.status).toBe(500);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  // A field that arrives with no bytes is as good as absent, and is caught by
  // the same check rather than being stored as an empty photograph.
  it('rejects a photograph that arrives empty', async () => {
    const res = await (async () => {
      const { startTrip, REQUIRED_START_PHOTOS } = await import('./tripController');
      const app = express();
      const asDriver = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as unknown as { driver: unknown }).driver = { id: 7 };
        // A file with no buffer is indistinguishable from an absent one.
        (req as unknown as { files: unknown }).files = Object.fromEntries(
          REQUIRED_START_PHOTOS.map((name) => [name, [{ buffer: Buffer.alloc(0), mimetype: 'image/jpeg' }]])
        );
        (req as unknown as { body: unknown }).body = { payload: JSON.stringify(payload) };
        next();
      };
      app.post('/trips/start', asDriver, startTrip);
      return request(app).post('/trips/start');
    })();

    expect(res.status).toBe(400);
    expect(tripCreate).not.toHaveBeenCalled();
  });
});
