import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { createTokenRefresher } from './tokenRefresh';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Bumped synchronously whenever the session ends deliberately, so a refresh
 * already in flight can tell that its result belongs to a session that is over.
 * See the sessionGeneration note in tokenRefresh.ts.
 */
let sessionGeneration = 0;
export const invalidateSession = (): void => {
  sessionGeneration += 1;
};

const clearTokens = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
};

const refresher = createTokenRefresher({
  getRefreshToken: () => localStorage.getItem('refreshToken'),
  // A bare axios call, not `api`: going through the instance would attach the
  // dead access token and recurse through this very interceptor on its 401.
  requestNewTokens: async (refreshToken) => {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  },
  saveTokens: ({ accessToken, refreshToken }) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  },
  clearTokens,
  sessionGeneration: () => sessionGeneration,
  // Only a verdict from the server ends the session. A rejection with no
  // response at all is an outage, and signing someone out over one would be
  // throwing away a refresh token that is probably still good.
  isTerminal: (error) => {
    const status = (error as AxiosError)?.response?.status;
    return status === 400 || status === 401 || status === 403;
  },
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * The access token lasts an hour, the refresh token seven days, and
 * /auth/refresh trades one for the other. This used to throw both away on the
 * first 401 and bounce to the login screen, so a dispatcher was signed out
 * every hour mid-task with no warning and no way back but typing a password.
 */
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;

    // `_retried` bounds this to one attempt per request: if the refreshed
    // token is also refused, the 401 is real and must surface.
    const isRefreshable =
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/login');

    if (!isRefreshable) {
      // A 401 on a request that already carried a freshly minted token means
      // the token is fine and the account is not: deleted, or a driver made
      // inactive. /auth/refresh only verifies the refresh token's signature,
      // so it keeps succeeding; without this the dashboard would sit there
      // looking signed in and re-running the same doomed cycle on every
      // request.
      if (error.response?.status === 401 && original?._retried) {
        clearTokens();
        window.location.href = `${import.meta.env.BASE_URL}login`;
      }
      return Promise.reject(error);
    }

    original._retried = true;
    const result = await refresher.refresh();

    if (result.status === 'expired') {
      window.location.href = `${import.meta.env.BASE_URL}login`;
      return Promise.reject(error);
    }

    if (result.status !== 'refreshed') {
      // 'unavailable': the server never gave a verdict, so the credentials
      // stay and the page reports the failure rather than signing anyone out.
      // 'superseded': this belongs to a session that ended mid-flight; there
      // is nothing to write and nothing to clear.
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${result.accessToken}`;
    return api(original);
  }
);

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  getMe: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email, type: 'user' }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
};

export const driversApi = {
  getAll: (params?: any) => api.get('/drivers', { params }),
  getById: (id: number) => api.get(`/drivers/${id}`),
  create: (data: any) => api.post('/drivers', data),
  update: (id: number, data: any) => api.put(`/drivers/${id}`, data),
  delete: (id: number) => api.delete(`/drivers/${id}`),
  assignVehicle: (id: number, vehicleId: number | null) => api.put(`/drivers/${id}/assign-vehicle`, { vehicleId }),
  setDestination: (id: number, address: string, note: string) => api.put(`/drivers/${id}/destination`, { address, note }),
  getStops: (id: number) => api.get(`/drivers/${id}/stops`),
  setStops: (id: number, stops: { id?: number; address: string; note: string; latitude: number | null; longitude: number | null }[], clearDone = false) =>
    api.put(`/drivers/${id}/stops`, { stops, clearDone }),
};

export const vehiclesApi = {
  getAll: (params?: any) => api.get('/vehicles', { params }),
  getById: (id: number) => api.get(`/vehicles/${id}`),
  create: (data: any) => api.post('/vehicles', data),
  update: (id: number, data: any) => api.put(`/vehicles/${id}`, data),
  delete: (id: number) => api.delete(`/vehicles/${id}`),
};

export const tripsApi = {
  getAll: (params?: any) => api.get('/trips', { params }),
  getActive: () => api.get('/trips/active'),
  getOfflineLocations: (params?: any) => api.get('/trips/offline-locations', { params }),
  getById: (id: number) => api.get(`/trips/${id}`),
  cancel: (id: number) => api.post(`/trips/${id}/cancel`),
};

export const reportsApi = {
  getTrips: (params?: any) => api.get('/reports/trips', { params }),
  getSummary: () => api.get('/reports/summary'),
  export: (params?: any) => api.get('/reports/export', { params, responseType: 'blob' }),
};

export const usersApi = {
  getAll: () => api.get('/users'),
  getById: (id: number) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: number, data: any) => api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
};

export const geoApi = {
  search: (q: string) => api.get('/geo/search', { params: { q } }),
};

export default api;
