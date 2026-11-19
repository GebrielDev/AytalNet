import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { tripsApi, vehiclesApi } from './api';

/**
 * Offline trip saving.
 *
 * Every start and end is written to a queue on the phone first, then sent.
 * With signal it is sent straight away and the driver sees no difference; out
 * of signal it waits and is sent automatically when the phone is back online
 * (network change, app brought to the foreground, or "Send now").
 *
 * The queue is sent strictly in order, so a trip's end never reaches the
 * server before its start. Each start carries a clientRef and each send can be
 * repeated safely: the server returns the trip it already created rather than
 * a second one, and an end it already applied is treated as success.
 *
 * Photos are copied out of the camera cache into the app's documents folder,
 * where the OS will not clear them before they are sent.
 */

export type StartPhotoType = 'license_plate' | 'driver_selfie' | 'start_odometer' | 'passenger';

interface VehicleSummary {
  id: number;
  plateNumber?: string;
  make?: string;
  model?: string;
}

export interface QueuedStart {
  kind: 'start';
  clientRef: string;
  driverId: number;
  vehicle: VehicleSummary;
  startedAt: string;
  startOdometer: number;
  startLatitude: number;
  startLongitude: number;
  photos: Partial<Record<StartPhotoType, string>>;
  error?: string;
}

export interface QueuedEnd {
  kind: 'end';
  clientRef: string;
  driverId: number;
  // The server id when the trip is already on the server, otherwise the
  // clientRef of the queued start it belongs to.
  tripId?: number;
  tripClientRef?: string;
  vehicle?: VehicleSummary;
  startedAt: string;
  startOdometer: number;
  endedAt: string;
  endOdometer: number;
  endLatitude: number;
  endLongitude: number;
  photoUri: string;
  photoSent?: boolean;
  error?: string;
}

export type QueuedItem = QueuedStart | QueuedEnd;

const QUEUE_KEY = 'offlineTrips:queue';
const SERVER_IDS_KEY = 'offlineTrips:serverIds';
const ACTIVE_KEY = 'offlineTrips:activeTrip';
const VEHICLE_KEY = 'offlineTrips:assignedVehicle';
const RECENT_KEY = 'offlineTrips:recentTrips';
const DESTINATION_KEY = 'offlineTrips:destination';

let currentDriverId: number | null = null;
const listeners = new Set<(queue: QueuedItem[]) => void>();
// Server replies to items sent during this app session, so a screen that just
// queued an item can pick up the trip the server created for it.
const delivered = new Map<string, any>();

export const newClientRef = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));

export const loadQueue = async (): Promise<QueuedItem[]> => {
  const queue = await readJson<QueuedItem[]>(QUEUE_KEY, []);
  return currentDriverId == null ? queue : queue.filter((item) => item.driverId === currentDriverId);
};

const saveQueue = async (queue: QueuedItem[]): Promise<void> => {
  // Items of another driver who used this phone are kept, never sent as this one.
  const all = await readJson<QueuedItem[]>(QUEUE_KEY, []);
  const others = all.filter((item) => item.driverId !== currentDriverId);
  await writeJson(QUEUE_KEY, [...others, ...queue]);
  listeners.forEach((listener) => listener(queue));
};

export const subscribeToQueue = (listener: (queue: QueuedItem[]) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Keeps a camera photo somewhere the OS will not clear before it is sent. */
export const keepPhoto = (uri: string, name: string): string => {
  if (Platform.OS === 'web') return uri;
  try {
    const dir = new Directory(Paths.document, 'pending-trip-photos');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, `${name}-${newClientRef()}.jpg`);
    new File(uri).copy(target);
    return target.uri;
  } catch (error) {
    console.log('Could not copy photo for offline saving', error);
    return uri;
  }
};

const removePhoto = (uri?: string) => {
  if (!uri || Platform.OS === 'web' || !uri.includes('pending-trip-photos')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A leftover file is harmless; it is only ever read by this queue.
  }
};

const appendPhoto = async (formData: FormData, field: string, uri: string, name: string) => {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    formData.append(field, blob, name);
    return;
  }
  formData.append(field, { uri, type: 'image/jpeg', name } as any);
};

/** No reply, a server fault, or an expired session: worth trying again later. */
const isTransient = (error: any): boolean => {
  const status = error?.response?.status;
  return !status || status >= 500 || status === 401 || status === 408 || status === 429;
};

const errorMessage = (error: any, fallback: string): string => error?.response?.data?.error || fallback;

const sendStart = async (item: QueuedStart): Promise<any> => {
  const formData = new FormData();
  formData.append(
    'payload',
    JSON.stringify({
      vehicleId: item.vehicle.id,
      startOdometer: item.startOdometer,
      startLatitude: item.startLatitude,
      startLongitude: item.startLongitude,
      clientRef: item.clientRef,
      startedAt: item.startedAt,
    })
  );
  for (const [photoType, uri] of Object.entries(item.photos)) {
    if (uri) await appendPhoto(formData, photoType, uri, `${photoType}.jpg`);
  }
  try {
    return (await tripsApi.start(formData)).data;
  } catch (error: any) {
    // A server without clientRef support answers a re-sent start this way.
    // If the active trip is this one, the earlier send got through.
    if (error?.response?.data?.error === 'You already have an active trip') {
      const active = (await tripsApi.getActiveTrip()).data;
      if (active && active.vehicleId === item.vehicle.id && Number(active.startOdometer) === item.startOdometer) {
        return active;
      }
    }
    throw error;
  }
};

const sendEnd = async (item: QueuedEnd, tripId: number, persist: () => Promise<void>): Promise<any> => {
  if (!item.photoSent) {
    const formData = new FormData();
    await appendPhoto(formData, 'photo', item.photoUri, 'end_odometer.jpg');
    formData.append('photoType', 'end_odometer');
    await tripsApi.uploadPhoto(tripId, formData);
    item.photoSent = true;
    await persist();
  }
  return (
    await tripsApi.end(tripId, {
      endOdometer: item.endOdometer,
      endLatitude: item.endLatitude,
      endLongitude: item.endLongitude,
      endedAt: item.endedAt,
    })
  ).data;
};

let running: Promise<void> | null = null;

/** Sends whatever is waiting, in order. Safe to call any time, from anywhere. */
export const syncNow = (): Promise<void> => {
  if (currentDriverId == null) return Promise.resolve();
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
  }
  return running;
};

const runSync = async (): Promise<void> => {
  const queue = await loadQueue();
  const serverIds = await readJson<Record<string, number>>(SERVER_IDS_KEY, {});

  while (queue.length > 0) {
    const item = queue[0];
    // A rejected item holds the queue until the driver discards it, so
    // nothing after it is sent out of order.
    if (item.error) break;

    try {
      if (item.kind === 'start') {
        const trip = await sendStart(item);
        serverIds[item.clientRef] = trip.id;
        await writeJson(SERVER_IDS_KEY, serverIds);
        delivered.set(item.clientRef, trip);
        Object.values(item.photos).forEach(removePhoto);
        const endQueued = queue.some((q) => q.kind === 'end' && q.tripClientRef === item.clientRef);
        if (!endQueued) await writeJson(ACTIVE_KEY, { ...trip, vehicle: trip.vehicle ?? item.vehicle });
      } else {
        const tripId = item.tripId ?? (item.tripClientRef ? serverIds[item.tripClientRef] : undefined);
        if (!tripId) {
          item.error = 'The start of this trip was not saved, so its end cannot be sent.';
          await saveQueue(queue);
          break;
        }
        const trip = await sendEnd(item, tripId, () => saveQueue(queue));
        delivered.set(item.clientRef, trip);
        removePhoto(item.photoUri);
        const active = await readJson<any>(ACTIVE_KEY, null);
        if (active?.id === tripId) await AsyncStorage.removeItem(ACTIVE_KEY);
      }
      queue.shift();
      await saveQueue(queue);
    } catch (error: any) {
      if (isTransient(error)) break;
      item.error = errorMessage(error, item.kind === 'start' ? 'The server refused this trip start.' : 'The server refused this trip end.');
      await saveQueue(queue);
      break;
    }
  }
};

/** What happened to one item the screen just queued. */
export type SendOutcome = { status: 'sent'; trip: any } | { status: 'saved' } | { status: 'rejected'; error: string };

const sendQueued = async (clientRef: string): Promise<SendOutcome> => {
  // Twice: a pass already under way when the item was queued did not see it.
  await syncNow();
  await syncNow();
  const queue = await loadQueue();
  const item = queue.find((q) => q.clientRef === clientRef);
  if (!item) return { status: 'sent', trip: delivered.get(clientRef) };
  if (item.error && queue[0]?.clientRef === clientRef) {
    // Rejected while the driver is still on the screen: give the item back
    // so they can correct it, exactly as the app behaved before.
    const error = item.error;
    await discardItem(clientRef);
    return { status: 'rejected', error };
  }
  return { status: 'saved' };
};

export const submitStart = async (start: Omit<QueuedStart, 'kind' | 'clientRef' | 'driverId'>): Promise<SendOutcome & { clientRef: string }> => {
  const item: QueuedStart = { ...start, kind: 'start', clientRef: newClientRef(), driverId: currentDriverId! };
  await saveQueue([...(await loadQueue()), item]);
  return { ...(await sendQueued(item.clientRef)), clientRef: item.clientRef };
};

export const submitEnd = async (end: Omit<QueuedEnd, 'kind' | 'clientRef' | 'driverId'>): Promise<SendOutcome> => {
  const item: QueuedEnd = { ...end, kind: 'end', clientRef: newClientRef(), driverId: currentDriverId! };
  await saveQueue([...(await loadQueue()), item]);
  return sendQueued(item.clientRef);
};

/** Drops an item, and the end of a trip whose start is dropped. */
export const discardItem = async (clientRef: string): Promise<void> => {
  const queue = await loadQueue();
  const doomed = queue.filter((q) => q.clientRef === clientRef || (q.kind === 'end' && q.tripClientRef === clientRef));
  doomed.forEach((q) => (q.kind === 'start' ? Object.values(q.photos).forEach(removePhoto) : removePhoto(q.photoUri)));
  await saveQueue(queue.filter((q) => !doomed.includes(q)));
};

const endIsQueued = (queue: QueuedItem[], trip: any): boolean =>
  queue.some(
    (q) =>
      q.kind === 'end' &&
      ((trip.id != null && q.tripId === trip.id) || (trip.clientRef != null && q.tripClientRef === trip.clientRef))
  );

/** A start saved on the phone that has not been ended, shaped like a server trip. */
const localActiveTrip = (queue: QueuedItem[]): any | null => {
  const starts = queue.filter((q): q is QueuedStart => q.kind === 'start');
  for (let i = starts.length - 1; i >= 0; i--) {
    const s = starts[i];
    if (!endIsQueued(queue, { clientRef: s.clientRef })) {
      return {
        clientRef: s.clientRef,
        pending: true,
        vehicleId: s.vehicle.id,
        vehicle: s.vehicle,
        startTime: s.startedAt,
        startOdometer: s.startOdometer,
      };
    }
  }
  return null;
};

/**
 * The driver's trip in progress: one saved on the phone, else the server's,
 * else - with no signal - the last one the server reported.
 */
export const getActiveTrip = async (): Promise<any | null> => {
  const queue = await loadQueue();
  const local = localActiveTrip(queue);
  if (local) return local;
  try {
    const trip = (await tripsApi.getActiveTrip()).data;
    if (trip) await writeJson(ACTIVE_KEY, trip);
    else await AsyncStorage.removeItem(ACTIVE_KEY);
    return trip && !endIsQueued(queue, trip) ? trip : null;
  } catch (error: any) {
    if (error?.response) return null;
    const cached = await readJson<any>(ACTIVE_KEY, null);
    return cached && !endIsQueued(queue, cached) ? cached : null;
  }
};

const cachedRead = async <T>(key: string, read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    const value = await read();
    await writeJson(key, value);
    return value;
  } catch (error: any) {
    if (error?.response) return fallback;
    return readJson<T>(key, fallback);
  }
};

// Kept on the phone so the destination still shows with no signal.
export const getDestination = () => cachedRead<any>(DESTINATION_KEY, async () => (await vehiclesApi.getMyDestination()).data, null);

export const getAssignedVehicle = () => cachedRead(VEHICLE_KEY, async () => (await vehiclesApi.getMyAssigned()).data, null);

export interface TripHistory {
  trips: any[];
  // True when the server could not be reached and the list is the copy saved
  // on the phone the last time it could.
  offline: boolean;
  savedAt: string | null;
}

/**
 * The driver's recent completed trips with their mileage. With no signal it
 * is the copy saved at the last successful fetch, and trips completed on the
 * phone but not yet sent are listed first, marked pending.
 */
export const getRecentTrips = async (): Promise<TripHistory> => {
  const queue = await loadQueue();
  const waiting = queue
    .filter((q): q is QueuedEnd => q.kind === 'end')
    .reverse()
    .map((q) => ({
      id: `pending-${q.clientRef}`,
      pending: true,
      startTime: q.startedAt,
      endTime: q.endedAt,
      durationMinutes: Math.max(0, Math.round((new Date(q.endedAt).getTime() - new Date(q.startedAt).getTime()) / 60000)),
      totalMileage: q.endOdometer - q.startOdometer,
      vehicle: q.vehicle,
    }));

  try {
    const data = (await tripsApi.getMyTrips()).data;
    const trips = Array.isArray(data) ? data : [];
    const savedAt = new Date().toISOString();
    await writeJson(RECENT_KEY, { trips, savedAt });
    return { trips: [...waiting, ...trips], offline: false, savedAt };
  } catch (error: any) {
    const saved = await readJson<{ trips: any[]; savedAt: string | null } | any[]>(RECENT_KEY, { trips: [], savedAt: null });
    // Copies saved by the previous build were a bare array.
    const copy = Array.isArray(saved) ? { trips: saved, savedAt: null } : saved;
    return { trips: [...waiting, ...copy.trips], offline: !error?.response, savedAt: copy.savedAt };
  }
};

/**
 * Called by AuthProvider with the signed-in driver (or null on sign-out).
 * Sends the queue whenever the phone comes back online or to the foreground.
 */
export const startOfflineSync = (driverId: number | null): (() => void) => {
  currentDriverId = driverId;
  if (driverId == null) return () => {};
  const unsubscribeNet = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) syncNow();
  });
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') syncNow();
  });
  syncNow();
  return () => {
    unsubscribeNet();
    appState.remove();
  };
};

/** Clears this driver's cached server data on sign-out. The queue is kept. */
export const clearOfflineCache = () => AsyncStorage.multiRemove([ACTIVE_KEY, VEHICLE_KEY, RECENT_KEY, DESTINATION_KEY]);
