import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// For emulator testing: 10.0.2.2 (Android default) or your host IP
// For physical device: Use your computer's local IP address
const API_URL = 'http://10.0.2.16:3001/api'; // Emulator IP

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

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/driver/login', { email, password }),
  getMe: () => api.get('/auth/me'),
};

export const vehiclesApi = {
  getAvailable: () => api.get('/vehicles/available'),
};

export const tripsApi = {
  getActiveTrip: () => api.get('/trips/my-active'),
  start: (data: any) => api.post('/trips/start', data),
  end: (id: number, data: any) => api.put(`/trips/${id}/end`, data),
  uploadPhoto: (tripId: number, formData: FormData) =>
    api.post(`/trips/${tripId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export default api;
