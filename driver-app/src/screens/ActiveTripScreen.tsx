import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStyles, type Palette } from '../theme';
import StopsCard from '../components/StopsCard';
import NotesCard from '../components/NotesCard';
import { useTripTracking } from '../hooks/useTripTracking';
import { getStops, subscribeToStops, type Stop } from '../services/offlineTrips';

export default function ActiveTripScreen() {
  const navigation = useNavigation<any>();
  const styles = useStyles(makeStyles);
  const route = useRoute<any>();
  const trip = route.params?.trip;

  const [duration, setDuration] = useState(0);
  const [stops, setStops] = useState<Stop[]>([]);
  // The office's board map follows the driver while this trip is open.
  useTripTracking(true);

  useEffect(() => {
    getStops().then(setStops);
    return subscribeToStops(setStops);
  }, []);

  useEffect(() => {
    const startTime = new Date(trip.startTime).getTime();

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      setDuration(diff);
    }, 1000);

    return () => clearInterval(interval);
  }, [trip.startTime]);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndTrip = () => {
    // Alert buttons do nothing in the web preview, so go straight on there.
    if (Platform.OS === 'web') {
      navigation.navigate('EndTrip', { trip });
      return;
    }
    Alert.alert('End Trip', 'Are you sure you want to end this trip?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Trip', onPress: () => navigation.navigate('EndTrip', { trip }) },
    ]);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.statusCard}>
        <View style={styles.statusIndicator} />
        <Text style={styles.statusText}>Trip in Progress</Text>
      </View>

      {trip.pending ? (
        <View style={styles.pendingCard} testID="active-trip-pending-notice">
          <Text style={styles.pendingText}>
            Saved on this phone. It will be sent to the office automatically when you are back online.
          </Text>
        </View>
      ) : null}

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Vehicle</Text>
        <Text style={styles.infoValue}>{trip.vehicle?.plateNumber || 'N/A'}</Text>
        {trip.vehicle?.make && (
          <Text style={styles.infoSub}>{trip.vehicle.make} {trip.vehicle.model}</Text>
        )}
      </View>

      <NotesCard />

      <StopsCard stops={stops} />

      <View style={styles.durationCard}>
        <Text style={styles.durationLabel}>Duration</Text>
        <Text style={styles.durationValue} testID="active-trip-duration">{formatDuration(duration)}</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Start Odometer</Text>
        <Text style={styles.infoValue}>{trip.startOdometer} mi</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Started At</Text>
        <Text style={styles.infoValue}>{new Date(trip.startTime).toLocaleString()}</Text>
      </View>

      <TouchableOpacity style={styles.endButton} onPress={handleEndTrip} testID="active-trip-end-button">
        <Text style={styles.endButtonText}>End Trip</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: c.bg },
  container: { flexGrow: 1, padding: 20, paddingBottom: 32 },
  statusCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.successSoft, padding: 16, borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: c.successBorder },
  statusIndicator: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#22c55e', marginRight: 12 },
  statusText: { fontSize: 17, fontWeight: '700', color: c.successText },
  pendingCard: { backgroundColor: c.warnSoft, padding: 14, borderRadius: 14, marginBottom: 14, borderWidth: 1, borderColor: c.warnBorder },
  pendingText: { fontSize: 14, color: c.warnText, fontWeight: '500', lineHeight: 20 },
  infoCard: { backgroundColor: c.card, padding: 18, borderRadius: 16, marginBottom: 14, borderWidth: 1, borderColor: c.border },
  infoLabel: { fontSize: 12, color: c.textMuted, marginBottom: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 18, fontWeight: '700', color: c.text },
  infoSub: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  durationCard: { backgroundColor: c.primary, padding: 28, borderRadius: 20, marginBottom: 14, alignItems: 'center', shadowColor: '#2563eb', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  durationLabel: { fontSize: 14, color: '#fff', marginBottom: 6, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  durationValue: { fontSize: 44, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  endButton: { backgroundColor: c.danger, padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 'auto', shadowColor: c.danger, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  endButtonText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
});
