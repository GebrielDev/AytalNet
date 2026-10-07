import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Op } from 'sequelize';
import express from 'express';
import request from 'supertest';

const tripCount = vi.fn();
const driverCount = vi.fn();
const vehicleCount = vi.fn();

vi.mock('../models', () => ({
  Trip: { count: (...a: unknown[]) => tripCount(...a), findAll: vi.fn() },
  Driver: { count: (...a: unknown[]) => driverCount(...a) },
  Vehicle: { count: (...a: unknown[]) => vehicleCount(...a) },
  TripPhoto: {},
}));

const buildApp = async () => {
  const { getSummaryStats } = await import('./reportController');
  const app = express();
  app.get('/summary', getSummaryStats);
  return app;
};

/**
 * The dashboard's stat cards open a list of the trips behind each number. The
 * boundaries are returned so that list can filter on the same instant the
 * count used - deriving them in the browser would use its timezone, not the
 * server's, and the list would disagree with the number above it.
 */
describe('GET /reports/summary ranges', () => {
  beforeEach(() => {
    driverCount.mockResolvedValue(0);
    vehicleCount.mockResolvedValue(0);
    tripCount.mockResolvedValue(0);
  });

  it('returns the three boundaries as ISO timestamps', async () => {
    const res = await request(await buildApp()).get('/summary');

    expect(res.status).toBe(200);
    for (const key of ['today', 'week', 'month'] as const) {
      expect(new Date(res.body.ranges[key]).toISOString()).toBe(res.body.ranges[key]);
    }
  });

  it('returns boundaries that are exactly what the counts were taken with', async () => {
    const res = await request(await buildApp()).get('/summary');

    // Trip.count is called for in_progress, then today, week and month. The
    // three window calls must carry the same instants the response advertises.
    // Op.gte is a Symbol, so the bound has to be read through it rather than
    // with Object.values, which does not enumerate symbol keys.
    const windows = tripCount.mock.calls
      .map(([arg]) => (arg as { where?: { startTime?: Record<symbol, Date> } })?.where?.startTime)
      .filter((clause): clause is Record<symbol, Date> => Boolean(clause))
      .map((clause) => clause[Op.gte as unknown as symbol]);

    expect(windows).toHaveLength(3);
    expect(windows.map((d) => d.toISOString())).toEqual([
      res.body.ranges.today,
      res.body.ranges.week,
      res.body.ranges.month,
    ]);
  });

  it('puts today at midnight, and week and month before it', async () => {
    const res = await request(await buildApp()).get('/summary');
    const { today, week, month } = res.body.ranges;

    const midnight = new Date(today);
    expect([midnight.getHours(), midnight.getMinutes(), midnight.getSeconds()]).toEqual([0, 0, 0]);
    expect(new Date(week).getTime()).toBeLessThan(new Date(today).getTime());
    expect(new Date(month).getTime()).toBeLessThan(new Date(week).getTime());
  });

  // Without an upper bound the drill-down lists trips the count never saw: the
  // cards refresh only on a reconnect, so a trip starting while a tab sits open
  // would show in the list and not in the number above it.
  it('returns an asOf upper bound taken before the counts ran', async () => {
    const before = Date.now();
    const res = await request(await buildApp()).get('/summary');
    const after = Date.now();

    const asOf = new Date(res.body.ranges.asOf).getTime();
    expect(asOf).toBeGreaterThanOrEqual(before);
    expect(asOf).toBeLessThanOrEqual(after);
  });

  it('puts asOf at or after every window boundary', async () => {
    const { today, week, month, asOf } = (await request(await buildApp()).get('/summary')).body.ranges;

    for (const boundary of [today, week, month]) {
      expect(new Date(asOf).getTime()).toBeGreaterThanOrEqual(new Date(boundary).getTime());
    }
  });

  it('keeps the existing fields, so the cards do not change shape', async () => {
    const res = await request(await buildApp()).get('/summary');

    for (const key of ['totalDrivers', 'activeDrivers', 'totalVehicles', 'activeVehicles',
                       'activeTrips', 'todayTrips', 'weekTrips', 'monthTrips']) {
      expect(res.body).toHaveProperty(key);
    }
  });
});
