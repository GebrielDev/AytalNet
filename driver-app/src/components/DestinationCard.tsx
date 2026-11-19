import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';

export interface Destination {
  address: string;
  note?: string | null;
  updatedAt?: string | null;
}

const encode = (address: string) => encodeURIComponent(address);

// https links: each opens the app when it is installed, the website when not.
const APPS = [
  { key: 'google', label: 'Google Maps', url: (a: string) => `https://www.google.com/maps/dir/?api=1&destination=${encode(a)}&travelmode=driving` },
  ...(Platform.OS === 'ios' ? [{ key: 'apple', label: 'Apple Maps', url: (a: string) => `https://maps.apple.com/?daddr=${encode(a)}&dirflg=d` }] : []),
  { key: 'waze', label: 'Waze', url: (a: string) => `https://waze.com/ul?q=${encode(a)}&navigate=yes` },
];

/**
 * Where the dispatcher wants the driver to go, with a Navigate button that
 * opens the driver's choice of maps app for turn-by-turn directions.
 */
export default function DestinationCard({ destination }: { destination: Destination }) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');

  const open = async (url: string) => {
    setError('');
    try {
      await Linking.openURL(url);
      setChoosing(false);
    } catch {
      setError('Could not open the maps app.');
    }
  };

  return (
    <View style={styles.card} testID="destination-card">
      <Text style={styles.label}>Destination</Text>
      <Text style={styles.address} testID="destination-address">{destination.address}</Text>
      {destination.note ? <Text style={styles.note} testID="destination-note">{destination.note}</Text> : null}

      {choosing ? (
        <View style={styles.options}>
          {APPS.map((app) => (
            <TouchableOpacity
              key={app.key}
              style={styles.option}
              onPress={() => open(app.url(destination.address))}
              testID={`navigate-with-${app.key}`}
            >
              <Text style={styles.optionText}>{app.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={() => setChoosing(false)} testID="navigate-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.navigate} onPress={() => setChoosing(true)} testID="navigate-button">
          <Text style={styles.navigateText}>Navigate</Text>
        </TouchableOpacity>
      )}
      {error ? <Text style={styles.error} testID="navigate-error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 16, padding: 16, marginBottom: 16 },
  label: { fontSize: 12, color: '#3b82f6', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  address: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  note: { fontSize: 14, color: '#64748b', marginTop: 4 },
  navigate: { marginTop: 12, backgroundColor: '#0f172a', minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navigateText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  options: { marginTop: 12, gap: 8 },
  option: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  optionText: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  error: { marginTop: 8, fontSize: 13, color: '#b91c1c' },
});
