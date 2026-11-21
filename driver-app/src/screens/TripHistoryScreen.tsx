import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Modal, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useColors, useStyles, type Palette } from '../theme';
import { tripsApi } from '../services/api';
import AuthPhoto from '../components/AuthPhoto';

const PHOTO_LABELS: Record<string, string> = {
  start_odometer: 'Start odometer',
  end_odometer: 'End odometer',
  license_plate: 'Plate',
  driver_selfie: 'Selfie',
  passenger: 'Passenger',
};
const ORDER = ['start_odometer', 'end_odometer', 'license_plate', 'driver_selfie', 'passenger'];

// 48410 rather than 48410.0; keeps a real decimal (e.g. 25.4).
const num = (n: unknown) => (n == null ? '-' : Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(1));
const date = (d: string) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The driver's completed trips from the last 30 days, with miles and photos. */
export default function TripHistoryScreen() {
  const styles = useStyles(makeStyles);
  const c = useColors();
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);

  const load = async () => {
    setError('');
    try {
      setTrips((await tripsApi.getMyTrips(30)).data);
    } catch {
      setError('No signal. Pull down to try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  const totalMiles = trips.reduce((sum, t) => sum + (Number(t.totalMileage) || 0), 0);

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={trips}
        keyExtractor={(t) => String(t.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primary} />}
        ListHeaderComponent={
          <View style={styles.summary} testID="history-summary">
            <Text style={styles.summaryValue}>{num(Math.round(totalMiles * 10) / 10)} mi</Text>
            <Text style={styles.summaryLabel}>{trips.length} {trips.length === 1 ? 'trip' : 'trips'} in the last 30 days</Text>
            {error ? <Text style={styles.error} testID="history-error">{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={!error ? <Text style={styles.empty}>No completed trips in the last 30 days</Text> : null}
        renderItem={({ item: t }) => {
          const photos = [...(t.photos || [])].sort((a: any, b: any) => ORDER.indexOf(a.photoType) - ORDER.indexOf(b.photoType));
          return (
            <View style={styles.card} testID={`history-trip-${t.id}`}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.date}>{date(t.endTime)}</Text>
                  <Text style={styles.sub}>{time(t.startTime) + ' – ' + time(t.endTime)}{t.durationMinutes != null ? ` · ${t.durationMinutes} min` : ''}</Text>
                  <Text style={styles.sub}>{t.vehicle?.plateNumber || 'Vehicle'}{t.vehicle?.make ? ` · ${t.vehicle.make} ${t.vehicle.model || ''}` : ''}</Text>
                </View>
                <View style={styles.miles}>
                  <Text style={styles.milesValue}>{num(t.totalMileage)}</Text>
                  <Text style={styles.milesLabel}>miles</Text>
                </View>
              </View>
              <Text style={styles.odo}>{`Odometer ${num(t.startOdometer)} → ${num(t.endOdometer)}`}</Text>
              {photos.length ? (
                <View style={styles.photos}>
                  {photos.map((p: any) => (
                    <TouchableOpacity key={p.id} onPress={() => setViewing(p.photoUrl)} testID={`history-photo-${p.id}`}>
                      <AuthPhoto uri={p.photoUrl} style={styles.thumb} />
                      <Text style={styles.photoLabel}>{PHOTO_LABELS[p.photoType] || p.photoType}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          );
        }}
      />
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <TouchableOpacity style={styles.viewer} activeOpacity={1} onPress={() => setViewing(null)} testID="history-photo-viewer">
          {viewing ? <AuthPhoto uri={viewing} style={styles.full} /> : null}
          <Text style={styles.close}>Tap to close</Text>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.bg },
  summary: { backgroundColor: c.primary, borderRadius: 16, padding: 20, marginBottom: 16 },
  summaryValue: { fontSize: 30, fontWeight: '800', color: '#fff' },
  summaryLabel: { fontSize: 14, color: '#fff', marginTop: 2, fontWeight: '600' },
  error: { marginTop: 8, fontSize: 13, color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 15, padding: 32 },
  card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  date: { fontSize: 16, fontWeight: '700', color: c.text },
  sub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  miles: { alignItems: 'flex-end' },
  milesValue: { fontSize: 22, fontWeight: '800', color: c.text },
  milesLabel: { fontSize: 12, color: c.textMuted },
  odo: { fontSize: 13, color: c.textSoft, marginTop: 8 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  photoLabel: { fontSize: 11, color: c.textMuted, marginTop: 3, width: 72, textAlign: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  full: { width: '100%', height: '80%', resizeMode: 'contain' },
  close: { color: '#fff', marginTop: 12, fontSize: 15, fontWeight: '600' },
});
