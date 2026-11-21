import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { createTokenRefresher } from './tokenRefresh';
import { tokenStorage } from './tokenStorage';

// Production API URL - override via EXPO_PUBLIC_API_URL env var at build time
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.startechsolutions.us/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await tokenStorage.getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Called when the session has ended for good: the server rejected the refresh
 * token, or a retried request still 401d because the account is gone.
 *
 * Clearing AsyncStorage is not enough on its own. AppNavigator chooses the
 * authenticated stack from AuthContext's in-memory `driver`, so a deactivated
 * driver would stay on the protected screens with every action failing until
 * they restarted the app. The dashboard gets this for free because it ends a
 * session with window.location.href, which reloads and resets state; there is
 * no equivalent here.
 *
 * AuthProvider registers a handler on mount.
 */
type SessionEndedHandler = () => void;
let onSessionEnded: SessionEndedHandler | null = null;

/**
 * Bumped synchronously whenever the session ends deliberately. AsyncStorage is
 * async, so comparing stored tokens is not enough on its own: the read can
 * resolve with the old token, logout can run before the refresher writes, and
 * the comparison then passes against a value that is already gone.
 */
let sessionGeneration = 0;
export const invalidateSession = (): void => {
  sessionGeneration += 1;
};

export const setOnSessionEnded = (handler: SessionEndedHandler | null): void => {
  onSessionEnded = handler;
};

const endSession = async (): Promise<void> => {
  invalidateSession();
  await tokenStorage.clear();
  onSessionEnded?.();
};

const refresher = createTokenRefresher({
  getRefreshToken: () => tokenStorage.getRefresh(),
  // A bare axios call, not `api`: going through the instance would attach the
  // dead access token and recurse through this very interceptor on its 401.
  requestNewTokens: async (refreshToken) => {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  },
  saveTokens: async ({ accessToken, refreshToken }) => {
    await tokenStorage.save(accessToken, refreshToken);
  },
  clearTokens: endSession,
  sessionGeneration: () => sessionGeneration,
  // Only a verdict from the server ends the session. A driver out of signal
  // must not be signed out mid-shift because a refresh could not be delivered.
  isTerminal: (error) => {
    const status = (error as AxiosError)?.response?.status;
    return status === 400 || status === 401 || status === 403;
  },
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * There was no response interceptor at all, so an access token expiring after
 * an hour simply failed whatever the driver was doing - most painfully, ending
 * a trip that started more than an hour earlier, which is most of them. The
 * refresh token was stored and never used.
 */
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;

    const isRefreshable =
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/driver/login');

    if (!isRefreshable) {
      // A 401 on a request that already carried a freshly minted token means
      // the account is gone or has been deactivated, not that the token aged
      // out. Clear up rather than looping on a refresh that keeps succeeding
      // while every real request keeps failing.
      if (error.response?.status === 401 && original?._retried) {
        await endSession();
      }
      return Promise.reject(error);
    }

    original._retried = true;
    const result = await refresher.refresh();
    // 'unavailable' keeps the credentials: the request failed, the session did
    // not. 'expired' has already cleared them; AuthContext sends the driver to
    // the login screen on next launch.
    if (result.status !== 'refreshed') return Promise.reject(error);

    original.headers.Authorization = `Bearer ${result.accessToken}`;
    return api(original);
  }
);

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/driver/login', { email, password }),
  getMe: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email, type: 'driver' }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
};

export const vehiclesApi = {
  getAvailable: () => api.get('/vehicles/available'),
  getMyAssigned: () => api.get('/drivers/my-vehicle'),
  getMyDestination: () => api.get('/drivers/my-destination'),
  getMyStops: () => api.get('/drivers/my-stops'),
  updateMyLocation: (latitude: number, longitude: number) => api.post('/drivers/my-location', { latitude, longitude }),
  // Multipart: latitude, longitude and the optional odometer reading and photo.
  arriveAtStop: (stopId: number, formData: FormData) =>
    api.post(`/drivers/my-stops/${stopId}/arrive`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export const tripsApi = {
  getActiveTrip: () => api.get('/trips/my-active'),
  getMyTrips: (days?: number) => api.get('/trips/my-trips', { params: days ? { days } : undefined }),
  // Multipart: a trip is created together with its required photographs in a
  // single request, so a failed photo upload cannot leave a trip stranded.
  start: (formData: FormData) =>
    api.post('/trips/start', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  end: (id: number, data: any) => api.put(`/trips/${id}/end`, data),
  uploadPhoto: (tripId: number, formData: FormData) =>
    api.post(`/trips/${tripId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export const notesApi = {
  getMine: () => api.get('/drivers/my-notes'),
  markRead: (id: number) => api.post(`/drivers/my-notes/${id}/read`),
  reply: (id: number, reply: string) => api.post(`/drivers/my-notes/${id}/reply`, { reply }),
};

export default api;
