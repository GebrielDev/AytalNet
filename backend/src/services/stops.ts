import { Server } from 'socket.io';
import { Driver, DriverStop } from '../models';
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
});

export const listStops = async (driverId: number) =>
  (await DriverStop.findAll({ where: { driverId }, order: [['position', 'ASC'], ['id', 'ASC']] })).map(stopView);

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
  at: { latitude: number; longitude: number } | null = null
) => {
  await stop.update({ arrivedAt: new Date(), arrivedDistanceMeters: distance, tripId, arrivedLatitude: at?.latitude ?? null, arrivedLongitude: at?.longitude ?? null });
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
