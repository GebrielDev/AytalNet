import { Server } from 'socket.io';
import { Op } from 'sequelize';
import { Driver, DriverStop, Trip } from '../models';
import { driverRoom } from '../socket';
import { distanceMeters, arrivalRadiusMeters } from './geo';

/**
 * Multi-stop jobs. A driver's stops are kept in order; the first one not yet
 * arrived at is their current destination. That stop is mirrored onto the
 * driver's destination fields, so trips keep recording where they were headed
 * and the trip-end arrival check keeps working unchanged.
 */

export const stopView = (s: DriverStop) => ({
  id: s.id,
  position: s.position,
  address: s.address,
  note: s.note ?? null,
  latitude: s.latitude != null ? Number(s.latitude) : null,
  longitude: s.longitude != null ? Number(s.longitude) : null,
  arrivedAt: s.arrivedAt ?? null,
  arrivedDistanceMeters: s.arrivedDistanceMeters ?? null,
  tripId: s.tripId ?? null,
  arrivedOdometer: s.arrivedOdometer != null ? Number(s.arrivedOdometer) : null,
  arrivedPhotoUrl: s.arrivedPhotoUrl ?? null,
  originalOdometer: s.originalOdometer != null ? Number(s.originalOdometer) : null,
  odometerCorrectedAt: s.odometerCorrectedAt ?? null,
  odometerCorrectedBy: s.odometerCorrectedBy ?? null,
  odometerCorrectionReason: s.odometerCorrectionReason ?? null,
});

type StopView = ReturnType<typeof stopView>;

/** Miles between two readings beyond which a stop reading is flagged as a likely typo. */
const jumpMiles = () => Number(process.env.ODOMETER_JUMP_MILES) || 300;

/**
 * Marks stop readings that look wrong: lower than the trip start or an
 * earlier stop, higher than the trip end, or an unlikely jump. `stops` are
 * one driver's stops in order.
 */
export const flagOdometers = async (stops: StopView[]) => {
  const tripIds = [...new Set(stops.map((s) => s.tripId).filter((id): id is number => id != null))];
  const trips = tripIds.length
    ? await Trip.findAll({ where: { id: { [Op.in]: tripIds } }, attributes: ['id', 'startOdometer', 'endOdometer'] })
    : [];
  const byId = new Map(trips.map((t) => [t.id, t]));
  let prev: { reading: number; label: string; tripId: number | null } | null = null;
  return stops.map((s) => {
    if (s.arrivedOdometer == null) return { ...s, odometerFlag: null as string | null };
    const reading = s.arrivedOdometer;
    const trip = s.tripId != null ? byId.get(s.tripId) : undefined;
    const start = trip?.startOdometer != null ? Number(trip.startOdometer) : null;
    const end = trip?.endOdometer != null ? Number(trip.endOdometer) : null;
    // Compare with the earlier stop only when it was on the same trip.
    // Stops arrived with no trip open are not compared with each other.
    const before = prev && s.tripId != null && prev.tripId === s.tripId ? prev : start != null ? { reading: start, label: 'trip start', tripId: s.tripId } : null;
    let flag: string | null = null;
    if (start != null && reading < start) flag = `Lower than trip start (${start})`;
    else if (before && reading < before.reading) flag = `Lower than ${before.label} (${before.reading})`;
    else if (end != null && reading > end) flag = `Higher than trip end (${end})`;
    else if (before && reading - before.reading > jumpMiles()) flag = `${Math.round(reading - before.reading)} mi since ${before.label} — check`;
    // Later stops are compared with the last good reading, not a typo.
    if (!flag) prev = { reading, label: `stop ${s.position}`, tripId: s.tripId };
    return { ...s, odometerFlag: flag };
  });
};

export const listStops = async (driverId: number) =>
  flagOdometers((await DriverStop.findAll({ where: { driverId }, order: [['position', 'ASC'], ['id', 'ASC']] })).map(stopView));

/**
 * Copies the current stop onto the driver and pushes the updated list to the
 * driver's phone. Called after every change to a driver's stops.
 */
export const syncDriverStops = async (io: Server | undefined, driverId: number) => {
  const stops = await listStops(driverId);
  const current = stops.find((s) => !s.arrivedAt) ?? null;
  await Driver.update(
    {
      destinationAddress: current?.address ?? null,
      destinationNote: current?.note ?? null,
      destinationLatitude: current?.latitude ?? null,
      destinationLongitude: current?.longitude ?? null,
      destinationUpdatedAt: current ? new Date() : null,
    },
    { where: { id: driverId } }
  );
  io?.of('/driver').to(driverRoom(driverId)).emit('stops:updated', stops);
  // The dashboard's stops board refreshes that driver's row.
  io?.to('dashboard').emit('stops:changed', { driverId });
  return stops;
};

/** Marks a stop reached and tells every open dashboard straight away. */
export const markStopArrived = async (
  io: Server | undefined,
  stop: DriverStop,
  distance: number | null,
  tripId: number | null,
  how: 'driver' | 'trip_end',
  at: { latitude: number; longitude: number } | null = null,
  proof: { odometer: number | null; photoUrl: string | null } = { odometer: null, photoUrl: null },
  when: Date = new Date()
) => {
  await stop.update({ arrivedAt: when, arrivedDistanceMeters: distance, tripId, arrivedLatitude: at?.latitude ?? null, arrivedLongitude: at?.longitude ?? null, arrivedOdometer: proof.odometer, arrivedPhotoUrl: proof.photoUrl });
  const driver = await Driver.findByPk(stop.driverId, { attributes: ['id', 'name'] });
  io?.to('dashboard').emit('driver:arrived', {
    driverId: stop.driverId,
    driverName: driver?.name ?? 'A driver',
    stopId: stop.id,
    position: stop.position,
    address: stop.address,
    distanceMeters: distance,
    tripId,
    how,
    at: stop.arrivedAt,
  });
  return syncDriverStops(io, stop.driverId);
};

/**
 * At trip end: the first stop still to visit that lies within the arrival
 * radius of where the trip ended is marked reached.
 */
export const arriveByTripEnd = async (io: Server | undefined, driverId: number, tripId: number, lat: number, lng: number): Promise<number | null> => {
  const pending = await DriverStop.findAll({ where: { driverId, arrivedAt: null }, order: [['position', 'ASC']] });
  for (const stop of pending) {
    if (stop.latitude == null || stop.longitude == null) continue;
    const d = distanceMeters(lat, lng, Number(stop.latitude), Number(stop.longitude));
    if (d <= arrivalRadiusMeters()) {
      await markStopArrived(io, stop, d, tripId, 'trip_end', { latitude: lat, longitude: lng });
      return d;
    }
  }
  return null;
};
