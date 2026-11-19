import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { keepPhoto, submitEnd } from '../services/offlineTrips';

export default function EndTripScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const trip = route.params?.trip;

  const [odometer, setOdometer] = useState('');
  const [odometerPhoto, setOdometerPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (!result.canceled) {
      setOdometerPhoto(result.assets[0].uri);
    }
  };

  const endTrip = async () => {
    if (odometer.trim() === '' || !odometerPhoto) {
      Alert.alert('Error', 'Please enter odometer reading and take a photo');
      return;
    }

    const endOdometerValue = parseFloat(odometer);
    // Unparseable input used to reach the API as null, which completed the trip
    // with no mileage rather than telling the driver anything.
    if (!Number.isFinite(endOdometerValue) || endOdometerValue < 0) {
      Alert.alert('Error', 'Enter the odometer reading as a number, for example 10432');
      return;
    }
    if (endOdometerValue < Number(trip.startOdometer)) {
      Alert.alert('Error', 'End odometer cannot be less than start odometer');
      return;
    }

    setLoading(true);
    try {
      const location = await Location.getCurrentPositionAsync({});

      // Saved on the phone first and sent right away when there is signal;
      // otherwise sent automatically once the phone is back online. The end
      // odometer photo goes first, then the trip is completed.
      const outcome = await submitEnd({
        tripId: trip.id,
        tripClientRef: trip.id ? undefined : trip.clientRef,
        vehicle: trip.vehicle,
        startedAt: trip.startTime,
        startOdometer: Number(trip.startOdometer),
        endedAt: new Date().toISOString(),
        endOdometer: endOdometerValue,
        endLatitude: location.coords.latitude,
        endLongitude: location.coords.longitude,
        photoUri: keepPhoto(odometerPhoto, 'end_odometer'),
      });

      if (outcome.status === 'rejected') {
        Alert.alert('Error', outcome.error);
        return;
      }

      navigation.popTo('Home', {
        notice:
          outcome.status === 'sent'
            ? 'Trip completed successfully!'
            : 'Trip saved on this phone. It will be sent automatically when you are back online.',
      });
    } catch (error: any) {
      Alert.alert('Error', 'Could not end the trip. Check that location is turned on and try again.');
    } finally {
      setLoading(false);
    }
  };

  const mileage = odometer ? parseFloat(odometer) - Number(trip.startOdometer) : 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Trip Summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Start Odometer:</Text>
          <Text style={styles.summaryValue}>{trip.startOdometer} mi</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Vehicle:</Text>
          <Text style={styles.summaryValue}>{trip.vehicle?.plateNumber || 'N/A'}</Text>
        </View>
        {trip.vehicle?.make && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Make/Model:</Text>
            <Text style={styles.summaryValue}>{trip.vehicle.make} {trip.vehicle.model}</Text>
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>End Odometer Reading *</Text>
      <TextInput
        style={styles.input}
        testID="end-odometer-input"
        placeholder="Enter current odometer"
        value={odometer}
        onChangeText={setOdometer}
        keyboardType="numeric"
      />

      {mileage > 0 && (
        <View style={styles.mileageCard}>
          <Text style={styles.mileageLabel}>Total Mileage</Text>
          <Text style={styles.mileageValue}>{mileage.toFixed(1)} mi</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Odometer Photo *</Text>
      <TouchableOpacity style={styles.photoButton} onPress={takePhoto} testID="end-odometer-photo">
        {odometerPhoto ? (
          <Image source={{ uri: odometerPhoto }} style={styles.photoPreview} />
        ) : (
          <Text style={styles.photoButtonText}>Take Photo of Odometer</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.endButton} onPress={endTrip} disabled={loading} testID="end-trip-submit">
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.endButtonText}>Complete Trip</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 20 },
  summaryCard: { backgroundColor: '#fff', padding: 20, borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  summaryTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 16, letterSpacing: -0.2 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  summaryLabel: { fontSize: 14, color: '#94a3b8' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#64748b', marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 16, fontSize: 16, color: '#0f172a' },
  mileageCard: { backgroundColor: '#eff6ff', padding: 18, borderRadius: 16, marginTop: 15, alignItems: 'center', borderWidth: 1, borderColor: '#bfdbfe' },
  mileageLabel: { fontSize: 12, color: '#3b82f6', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  mileageValue: { fontSize: 28, fontWeight: '800', color: '#1e40af', marginTop: 4, letterSpacing: -0.5 },
  photoButton: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#e2e8f0', borderStyle: 'dashed', borderRadius: 16, height: 150, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  photoButtonText: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
  photoPreview: { width: '100%', height: '100%' },
  endButton: { backgroundColor: '#059669', padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 30, marginBottom: 40, shadowColor: '#059669', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  endButtonText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
});
