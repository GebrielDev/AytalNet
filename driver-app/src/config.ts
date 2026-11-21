/**
 * Where the app finds the fleet API.
 *
 * - Emergent builds: EXPO_PUBLIC_BACKEND_URL (set by the Emergent deploy). The
 *   API is under /api there, and live updates under /api/socket.io.
 * - Own Expo builds (eas.json): EXPO_PUBLIC_API_URL, normally
 *   https://api.startechsolutions.us/api, with live updates at /socket.io.
 */
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/+$/, '');

export const API_URL = BACKEND_URL
  ? `${BACKEND_URL}/api`
  : process.env.EXPO_PUBLIC_API_URL || 'https://api.startechsolutions.us/api';

export const SOCKET_PATH = BACKEND_URL ? '/api/socket.io' : process.env.EXPO_PUBLIC_SOCKET_PATH || '/socket.io';
