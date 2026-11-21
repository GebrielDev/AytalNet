import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { setNotesLocal } from '../services/notes';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, setOnSessionEnded, invalidateSession } from '../services/api';
import { startOfflineSync, clearOfflineCache } from '../services/offlineTrips';
import { startLiveUpdates } from '../services/liveUpdates';

interface Driver {
  id: number;
  employeeId: string;
  email: string;
  name: string;
  phone: string;
}

interface AuthContextType {
  driver: Driver | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// The signed-in driver, kept so the app opens with no signal.
const PROFILE_KEY = 'driverProfile';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  // The interceptor ends a session from outside React when the server rejects
  // the refresh token or the account is gone. Without this the navigator would
  // keep showing the authenticated stack, because it reads this value and
  // nothing else, and every screen on it would fail silently until a restart.
  useEffect(() => {
    setOnSessionEnded(() => {
      AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
      clearOfflineCache().catch(() => {});
      setNotesLocal([]);
      setDriver(null);
    });
    return () => setOnSessionEnded(null);
  }, []);

  // Trips saved offline are sent for the signed-in driver whenever the phone
  // is back online or returns to the foreground.
  useEffect(() => startOfflineSync(driver?.id ?? null), [driver?.id]);
  // A destination set by the dispatcher appears at once while the app is open.
  useEffect(() => startLiveUpdates(driver?.id ?? null), [driver?.id]);

  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (token) {
        const res = await authApi.getMe();
        setDriver(res.data.driver);
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(res.data.driver));
      }
    } catch (error: any) {
      // No signal at launch: open with the saved driver so trips and stops
      // work offline; the server re-checks the session once it is reachable.
      if (!error?.response) {
        const saved = await AsyncStorage.getItem(PROFILE_KEY);
        if (saved && (await AsyncStorage.getItem('accessToken'))) setDriver(JSON.parse(saved));
      }
      // Deliberately does not clear anything. The response interceptor in
      // services/api.ts owns session termination: the refresher clears the
      // credentials when the server rejects the refresh token, and the
      // interceptor clears them when a retried request still 401s because the
      // account is gone. Clearing here as well was double policy with less
      // information - the error that arrives is the original 401, so an app
      // opened out of signal looked identical to a closed account, and the
      // driver lost a refresh token still good for days.
      //
      // The driver stays null, so the login screen shows; if the credentials
      // are still valid, the next launch picks the session back up.
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    await AsyncStorage.setItem('accessToken', res.data.accessToken);
    await AsyncStorage.setItem('refreshToken', res.data.refreshToken);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(res.data.driver));
    setDriver(res.data.driver);
  };

  const logout = async () => {
    // Synchronously first, before anything is awaited. A refresh already past
    // its own getRefreshToken() would otherwise compare against a token that is
    // still stored at that instant, pass, and write BOTH credentials back after
    // the driver signed out. Combining the two removals closed the window
    // between them; only a synchronous marker closes this one.
    invalidateSession();
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken', PROFILE_KEY]);
    await clearOfflineCache();
    setNotesLocal([]);
    setDriver(null);
  };

  return (
    <AuthContext.Provider value={{ driver, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
