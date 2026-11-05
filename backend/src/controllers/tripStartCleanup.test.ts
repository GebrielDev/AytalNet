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
const uploadStream = vi.fn();
const destroy = vi.fn();

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
vi.mock('../config/cloudinary', () => ({
  default: {
    uploader: {
      upload_stream: (...a: unknown[]) => uploadStream(...a),
      destroy: (...a: unknown[]) => destroy(...a),
    },
  },
}));

/**
 * Drives the real Cloudinary code path: upload_stream takes an options object
 * and a callback, and returns something with .end(buffer). `succeed` says how
 * many of the four uploads land before the rest start failing, so a part-way
 * Cloudinary outage can be reproduced.
 */
const cloudinaryUploads = (succeed: number) => {
  let call = 0;
  uploadStream.mockImplementation((_opts: unknown, cb: any) => {
    const n = call++;
    return {
      end: () => {
        if (n < succeed) {
          cb(null, { secure_url: `https://res.cloudinary.com/x/${n}.jpg`, public_id: `trips/asset-${n}` });
        } else {
          cb(new Error('cloudinary unavailable'), null);
        }
      },
    };
  });
};

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

const post = async (raw?: string) => {
  const { REQUIRED_START_PHOTOS } = await import('./tripController');
  let req = request(await buildApp())
    .post('/trips/start')
    .field('payload', raw ?? JSON.stringify(payload));
  for (const name of REQUIRED_START_PHOTOS) {
    req = req.attach(name, Buffer.from('fake-jpeg-bytes'), `${name}.jpg`);
  }
  return req;
};

/**
 * Raised by Codex review on #23: rolling the transaction back only undoes the
 * database, so the photos stayed in Cloudinary with no trip_photos row left to
 * point at them - and the retention job walks that table, so a driver selfie
 * or passenger photograph would have sat there permanently with nothing able
 * to find it again.
 */
describe('a start that fails does not strand photographs in Cloudinary', () => {
  beforeEach(() => {
    tripFindOne.mockResolvedValue(null);
    vehicleFindByPk.mockResolvedValue({ id: 3, status: 'active' });
    tripCreate.mockResolvedValue({ id: 99 });
    tripFindByPk.mockResolvedValue({ id: 99 });
    photoBulkCreate.mockResolvedValue([]);
    commit.mockResolvedValue(undefined);
    rollback.mockResolvedValue(undefined);
    transaction.mockResolvedValue({ commit, rollback });
    destroy.mockResolvedValue({ result: 'ok' });
    cloudinaryUploads(4);
  });

  it('keeps the assets when the trip is committed', async () => {
    const res = await post();

    expect(res.status).toBe(201);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('deletes all four when the photo rows fail', async () => {
    photoBulkCreate.mockRejectedValue(new Error('insert failed'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(destroy.mock.calls.map((c) => c[0]).sort()).toEqual([
      'trips/asset-0', 'trips/asset-1', 'trips/asset-2', 'trips/asset-3',
    ]);
  });

  it('deletes them when the trip row fails', async () => {
    tripCreate.mockRejectedValue(new Error('insert failed'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(destroy).toHaveBeenCalledTimes(4);
  });

  // Codex listed this one explicitly: the transaction can fail to open, and
  // the photos are already uploaded by then.
  it('deletes them when the transaction cannot even be opened', async () => {
    transaction.mockRejectedValue(new Error('no connection'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(destroy).toHaveBeenCalledTimes(4);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('deletes them when the commit fails', async () => {
    commit.mockRejectedValue(new Error('commit failed'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(destroy).toHaveBeenCalledTimes(4);
  });

  // Only the two that reached Cloudinary have anything to delete; the other
  // two fell back to a base64 data URI, which lives in the row itself.
  it('deletes only the assets that actually reached Cloudinary', async () => {
    cloudinaryUploads(2);
    photoBulkCreate.mockRejectedValue(new Error('insert failed'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(destroy.mock.calls.map((c) => c[0]).sort()).toEqual(['trips/asset-0', 'trips/asset-1']);
  });

  // A rollback is most likely to misbehave exactly when the write failed
  // because the connection died, and the cleanup must not be skipped then.
  it.each([
    ['rejects', () => rollback.mockRejectedValue(new Error('connection lost'))],
    ['throws synchronously', () => rollback.mockImplementation(() => { throw new Error('gone'); })],
    ['returns no promise', () => rollback.mockReturnValue(undefined as never)],
  ])('still deletes the assets when the rollback %s', async (_label, breakRollback) => {
    photoBulkCreate.mockRejectedValue(new Error('insert failed'));
    breakRollback();

    const res = await post();

    expect(res.status).toBe(500);
    expect(destroy).toHaveBeenCalledTimes(4);
  });

  // The start is already failing for a reason worth reporting; a cleanup that
  // cannot complete must not replace it with a different error.
  it('still reports the start failure when the cleanup itself fails', async () => {
    photoBulkCreate.mockRejectedValue(new Error('insert failed'));
    destroy.mockRejectedValue(new Error('cloudinary down'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to start trip');
  });

  // A failure after the commit means the trip and its rows are real, so the
  // assets must stay even though the response could not be built.
  it('keeps the assets when only the post-commit read fails', async () => {
    tripFindByPk.mockRejectedValue(new Error('read failed'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});

/**
 * Also raised by Codex on #23: `null` is valid JSON, so JSON.parse accepted it
 * and the destructuring that followed threw, surfacing as a 500 instead of
 * telling the caller what was wrong with the request.
 */
describe('a payload that is not an object is a 400, not a 500', () => {
  beforeEach(() => {
    tripFindOne.mockResolvedValue(null);
    vehicleFindByPk.mockResolvedValue({ id: 3, status: 'active' });
    tripCreate.mockResolvedValue({ id: 99 });
    tripFindByPk.mockResolvedValue({ id: 99 });
    photoBulkCreate.mockResolvedValue([]);
    transaction.mockResolvedValue({ commit, rollback });
    cloudinaryUploads(4);
  });

  it.each([
    ['null', 'null'],
    ['a bare number', '1000'],
    ['a bare string', '"phoenix"'],
    ['an array', '[1,2,3]'],
    ['true', 'true'],
  ])('rejects %s with 400 and creates nothing', async (_label, raw) => {
    const res = await post(raw);

    expect(res.status).toBe(400);
    expect(tripCreate).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('still rejects malformed JSON with 400', async () => {
    const res = await post('{not json');

    expect(res.status).toBe(400);
    expect(tripCreate).not.toHaveBeenCalled();
  });
});
