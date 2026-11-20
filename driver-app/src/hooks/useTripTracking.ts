import { useEffect } from 'react';
import * as Location from 'expo-location';
import { vehiclesApi } from '../services/api';

/**
 * Shares the driver's position with the office every ~30 s while a trip is in
 * progress and the app is open, so the dashboard's board map follows them.
 * The server ignores points outside a trip, so nobody is tracked off duty.
 *
 * Foreground only: with the app in the background (e.g. while a maps app is
 * open) the phone pauses it. Sharing in the background needs a store build
 * with background location permission.
 */
export const useTripTracking = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let stopped = false;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      // Permission was asked at trip start; never prompt from here.
      if (status !== 'granted' || stopped) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 50 },
        (pos) => {
          vehiclesApi.updateMyLocation(pos.coords.latitude, pos.coords.longitude).catch(() => {
            // No signal or no trip: the next point tries again.
          });
        }
      );
      if (stopped) sub.remove();
    })();
    return () => {
      stopped = true;
      sub?.remove();
    };
  }, [active]);
};
