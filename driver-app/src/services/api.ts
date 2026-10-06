import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTokenRefresher } from './tokenRefresh';

// Production API URL - override via EXPO_PUBLIC_API_URL env var at build time
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.startechsolutions.us/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const refresher = createTokenRefresher({
  getRefreshToken: () => AsyncStorage.getItem('refreshToken'),
  // A bare axios call, not `api`: going through the instance would attach the
  // dead access token and recurse through this very interceptor on its 401.
  requestNewTokens: async (refreshToken) => {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  },
  saveTokens: async ({ accessToken, refreshToken }) => {
    await AsyncStorage.multiSet([
      ['accessToken', accessToken],
      ['refreshToken', refreshToken],
    ]);
  },
  clearTokens: async () => {
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
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

    if (!isRefreshable) return Promise.reject(error);

    original._retried = true;
    const accessToken = await refresher.refresh();
    if (!accessToken) return Promise.reject(error);

    original.headers.Authorization = `Bearer ${accessToken}`;
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
};

export const tripsApi = {
  getActiveTrip: () => api.get('/trips/my-active'),
  getMyTrips: () => api.get('/trips/my-trips'),
  start: (data: any) => api.post('/trips/start', data),
  end: (id: number, data: any) => api.put(`/trips/${id}/end`, data),
  uploadPhoto: (tripId: number, formData: FormData) =>
    api.post(`/trips/${tripId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export default api;
