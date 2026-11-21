import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Sign-in tokens live in the phone's encrypted storage (iOS Keychain /
 * Android Keystore). The web preview has no secure vault, so it uses
 * AsyncStorage there. Tokens saved by older app versions in AsyncStorage are
 * moved over the first time they are read.
 */
const ACCESS = 'accessToken';
const REFRESH = 'refreshToken';
const secure = Platform.OS !== 'web';

const read = async (key: string): Promise<string | null> => {
  if (!secure) return AsyncStorage.getItem(key);
  // A locked or failing keychain reads as "signed out" rather than crashing startup.
  const value = await SecureStore.getItemAsync(key).catch(() => null);
  if (value) return value;
  const legacy = await AsyncStorage.getItem(key);
  if (legacy) {
    try {
      await SecureStore.setItemAsync(key, legacy, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
      await AsyncStorage.removeItem(key);
    } catch {
      // Keychain unavailable: keep using the old copy; moved next time.
    }
  }
  return legacy;
};

const write = async (key: string, value: string): Promise<void> => {
  if (!secure) return AsyncStorage.setItem(key, value);
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
};

export const tokenStorage = {
  getAccess: () => read(ACCESS),
  getRefresh: () => read(REFRESH),
  save: async (accessToken: string, refreshToken: string): Promise<void> => {
    await Promise.all([write(ACCESS, accessToken), write(REFRESH, refreshToken)]);
  },
  clear: async (): Promise<void> => {
    await AsyncStorage.multiRemove([ACCESS, REFRESH]);
    if (secure) await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]).catch(() => {});
  },
};
