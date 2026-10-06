import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const tripFindOne = vi.fn();
const tripCreate = vi.fn();
const tripFindByPk = vi.fn();
const vehicleFindByPk = vi.fn();

vi.mock('../models', () => ({
  Trip: {
    findOne: (...a: unknown[]) => tripFindOne(...a),
    create: (...a: unknown[]) => tripCreate(...a),
    findByPk: (...a: unknown[]) => tripFindByPk(...a),
    findAll: vi.fn(), count: vi.fn(), update: vi.fn(),
  },
  TripPhoto: {}, Driver: {},
  Vehicle: { findByPk: (...a: unknown[]) => vehicleFindByPk(...a), update: vi.fn() },
}));
vi.mock('../config/cloudinary', () => ({ default: { uploader: { upload_stream: vi.fn() } } }));

const buildApp = async () => {
  const { startTrip } = await import('./tripController');
  const app = express();
  app.use(express.json());
  // Stands in for authenticateToken + requireDriver, which have their own tests.
  app.post('/trips/start', (req, _res, next) => {
    (req as unknown as { driver: unknown }).driver = { id: 7 };
    next();
  }, startTrip);
  return app;
};

const body = {
  vehicleId: 3, startOdometer: 1000,
  startLatitude: 33.4484, startLongitude: -112.074, startAddress: 'Phoenix',
};

describe('POST /trips/start coordinate validation', () => {
  beforeEach(() => {
    tripFindOne.mockResolvedValue(null);
    vehicleFindByPk.mockResolvedValue({ id: 3, status: 'active' });
    tripCreate.mockResolvedValue({ id: 99 });
    tripFindByPk.mockResolvedValue({ id: 99 });
  });

  it('starts a trip with valid coordinates', async () => {
    const res = await request(await buildApp()).post('/trips/start').send(body);
    expect(res.status).toBe(201);
    expect(tripCreate).toHaveBeenCalled();
  });

  // start_latitude/start_longitude became nullable for the retention job. The
  // NOT NULL used to be the only thing rejecting a trip with no location, so
  // without this check a malformed or direct POST would create one.
  it.each([
    ['missing both', {}],
    ['missing longitude', { startLatitude: 33.4 }],
    ['missing latitude', { startLongitude: -112.0 }],
    ['null coordinates', { startLatitude: null, startLongitude: null }],
    ['strings', { startLatitude: '33.4', startLongitude: '-112.0' }],
    ['NaN', { startLatitude: Number.NaN, startLongitude: 0 }],
    ['latitude out of range', { startLatitude: 91, startLongitude: 0 }],
    ['longitude out of range', { startLatitude: 0, startLongitude: 181 }],
  ])('rejects %s with 400 and creates nothing', async (_label, coords) => {
    const { startLatitude, startLongitude, ...rest } = body;
    const res = await request(await buildApp())
      .post('/trips/start')
      .send({ ...rest, ...coords });

    expect(res.status).toBe(400);
    expect(tripCreate).not.toHaveBeenCalled();
  });

  it('accepts the equator and prime meridian', async () => {
    const res = await request(await buildApp())
      .post('/trips/start')
      .send({ ...body, startLatitude: 0, startLongitude: 0 });

    expect(res.status).toBe(201);
  });
});
