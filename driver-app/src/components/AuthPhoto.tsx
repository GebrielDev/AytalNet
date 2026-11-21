import React, { useEffect, useState } from 'react';
import { Image, View, StyleSheet, Platform, type ImageStyle, type StyleProp } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Trip photos are private: the server only hands them out with the driver's
 * sign-in. Phones send the header with the image request; the web preview
 * fetches the image first and shows it from memory.
 */
export default function AuthPhoto({ uri, style, testID }: { uri: string; style: StyleProp<ImageStyle>; testID?: string }) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      if (uri.startsWith('data:')) return setSource({ uri });
      const token = await AsyncStorage.getItem('accessToken');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      if (Platform.OS !== 'web') return setSource({ uri, headers });
      try {
        const res = await fetch(uri, { headers });
        if (!res.ok || cancelled) return;
        objectUrl = URL.createObjectURL(await res.blob());
        setSource({ uri: objectUrl });
      } catch {
        // Shown as an empty tile.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri]);

  if (!source) return <View style={[style as any, styles.placeholder]} testID={testID} />;
  return <Image source={source} style={style} testID={testID} />;
}

const styles = StyleSheet.create({ placeholder: { backgroundColor: 'rgba(128,128,128,0.2)' } });
