import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const tripFindOne = vi.fn();
const tripCreate = vi.fn();
const tripFindByPk = vi.fn();
const vehicleFindByPk = vi.fn();
const vehicleUpdate = vi.fn();

vi.mock('../models', () => ({
  Trip: {
    findOne: (...a: unknown[]) => tripFindOne(...a),
    create: (...a: unknown[]) => tripCreate(...a),
    findByPk: (...a: unknown[]) => tripFindByPk(...a),
    findAll: vi.fn(), count: vi.fn(), update: vi.fn(),
  },
  TripPhoto: {}, Driver: {},
  Vehicle: {
    findByPk: (...a: unknown[]) => vehicleFindByPk(...a),
    update: (...a: unknown[]) => vehicleUpdate(...a),
  },
}));
vi.mock('../config/cloudinary', () => ({ default: { uploader: { upload_stream: vi.fn() } } }));

const buildApp = async () => {
  const { startTrip, endTrip } = await import('./tripController');
  const app = express();
  app.use(express.json());
  // Stands in for authenticateToken + requireDriver, which have their own tests.
  const asDriver = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { driver: unknown }).driver = { id: 7 };
    next();
  };
  app.post('/trips/start', asDriver, startTrip);
  app.post('/trips/:id/end', asDriver, endTrip);
  return app;
};

const startBody = {
  vehicleId: 3, startOdometer: 1000,
  startLatitude: 33.4484, startLongitude: -112.074, startAddress: 'Phoenix',
};

const endBody = { endOdometer: 1050, endLatitude: 33.4484, endLongitude: -112.074 };

/**
 * The driver app requires a reading on both screens, but that is not the
 * guarantee - these cover the API, where the readings were previously
 * unvalidated.
 */
describe('odometer readings are required', () => {
  let tripUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tripCreate.mockReset();
    vehicleUpdate.mockReset();
    vehicleFindByPk.mockResolvedValue({ id: 3, status: 'active' });
    tripCreate.mockResolvedValue({ id: 99 });
    tripFindByPk.mockResolvedValue({ id: 99 });
    tripUpdate = vi.fn().mockResolvedValue(undefined);
  });

  describe('POST /trips/start', () => {
    beforeEach(() => {
      tripFindOne.mockResolvedValue(null);
    });

    it.each([
      ['omitted', {}],
      // What parseFloat('abc') becomes once it is JSON.
      ['null', { startOdometer: null }],
      ['a string', { startOdometer: '1000' }],
      ['NaN', { startOdometer: Number.NaN }],
      ['Infinity', { startOdometer: Number.POSITIVE_INFINITY }],
      ['negative', { startOdometer: -500 }],
    ])('rejects %s with 400 and creates no trip', async (_label, override) => {
      const { startOdometer, ...rest } = startBody;
      const res = await request(await buildApp()).post('/trips/start').send({ ...rest, ...override });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/odometer/i);
      expect(tripCreate).not.toHaveBeenCalled();
    });

    it('accepts zero, which is a real reading on a new vehicle', async () => {
      const res = await request(await buildApp())
        .post('/trips/start')
        .send({ ...startBody, startOdometer: 0 });

      expect(res.status).toBe(201);
      expect(tripCreate).toHaveBeenCalledWith(expect.objectContaining({ startOdometer: 0 }));
    });
  });

  describe('POST /trips/:id/end', () => {
    beforeEach(() => {
      tripFindOne.mockResolvedValue({
        id: 99, vehicleId: 3, startOdometer: '1000',
        startTime: new Date(Date.now() - 3600_000),
        update: (...a: unknown[]) => tripUpdate(...a),
      });
    });

    // The one that mattered: an absent reading is not "less than start", so it
    // passed that check and completed the trip with a NaN mileage and no
    // odometer, which dropped the trip out of mileage reporting entirely.
    it.each([
      ['omitted', {}],
      ['null', { endOdometer: null }],
      ['a string', { endOdometer: '1050' }],
      ['NaN', { endOdometer: Number.NaN }],
      ['negative', { endOdometer: -1 }],
    ])('rejects %s with 400 and leaves the trip in progress', async (_label, override) => {
      const { endOdometer, ...rest } = endBody;
      const res = await request(await buildApp()).post('/trips/99/end').send({ ...rest, ...override });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/odometer/i);
      expect(tripUpdate).not.toHaveBeenCalled();
      expect(vehicleUpdate).not.toHaveBeenCalled();
    });

    // Raised by Codex review: it expected a body-less request to throw in the
    // destructuring and surface as a 500. It does not - express.json() defaults
    // req.body to an object - but the case is worth pinning either way.
    it('rejects a request with no body at all, as a 400 rather than a 500', async () => {
      const res = await request(await buildApp()).post('/trips/99/end');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/odometer/i);
      expect(tripUpdate).not.toHaveBeenCalled();
    });

    it('still rejects a reading below the start reading', async () => {
      const res = await request(await buildApp()).post('/trips/99/end').send({ ...endBody, endOdometer: 999 });

      expect(res.status).toBe(400);
      expect(tripUpdate).not.toHaveBeenCalled();
    });

    it('completes the trip with a valid reading, recording the mileage', async () => {
      const res = await request(await buildApp()).post('/trips/99/end').send(endBody);

      expect(res.status).toBe(200);
      expect(tripUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', endOdometer: 1050, totalMileage: 50 })
      );
      expect(vehicleUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ currentOdometer: 1050 }),
        expect.anything()
      );
    });
  });
});
