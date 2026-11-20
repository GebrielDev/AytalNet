import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Image, ActivityIndicator, Animated, Easing } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { getAssignedVehicle, getSavedDestination, keepPhoto, submitStart } from '../services/offlineTrips';

export default function StartTripScreen() {
  const navigation = useNavigation<any>();
  const [assignedVehicle, setAssignedVehicle] = useState<any>(null);
  const [odometer, setOdometer] = useState('');
  const [licensePlatePhoto, setLicensePlatePhoto] = useState<string | null>(null);
  const [selfiePhoto, setSelfiePhoto] = useState<string | null>(null);
  const [odometerPhoto, setOdometerPhoto] = useState<string | null>(null);
  const [passengerPhoto, setPassengerPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingVehicle, setLoadingVehicle] = useState(true);
  const [step, setStep] = useState(0);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(1 / 5)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // Slides the progress bar and fades the next step in.
  const goTo = (next: number) => {
    setStep(next);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(progress, { toValue: (next + 1) / 5, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: false }),
    ]).start();
  };

  useEffect(() => {
    fetchAssignedVehicle();
    requestPermissions();
  }, []);

  const requestPermissions = async () => {
    await ImagePicker.requestCameraPermissionsAsync();
    await Location.requestForegroundPermissionsAsync();
  };

  const fetchAssignedVehicle = async () => {
    try {
      // Falls back to the last vehicle the server reported when out of signal.
      setAssignedVehicle(await getAssignedVehicle());
    } catch (error) {
      console.log('Failed to fetch assigned vehicle');
    } finally {
      setLoadingVehicle(false);
    }
  };

  const takePhoto = async (type: 'license_plate' | 'selfie' | 'odometer' | 'passenger') => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      if (type === 'license_plate') setLicensePlatePhoto(uri);
      else if (type === 'selfie') setSelfiePhoto(uri);
      else if (type === 'odometer') setOdometerPhoto(uri);
      else setPassengerPhoto(uri);
    }
  };

  const startTrip = async () => {
    // Checked as a number rather than a non-empty string: "0" is a legitimate
    // reading on a new vehicle, and anything unparseable used to reach the API
    // as null and come back as a bare "Failed to start trip".
    const odometerValue = parseFloat(odometer);
    if (odometer.trim() !== '' && !(Number.isFinite(odometerValue) && odometerValue >= 0)) {
      Alert.alert('Error', 'Enter the odometer reading as a number, for example 10432');
      return;
    }

    if (
      !assignedVehicle ||
      odometer.trim() === '' ||
      !licensePlatePhoto ||
      !selfiePhoto ||
      !odometerPhoto
    ) {
      Alert.alert('Error', 'Please complete all required fields');
      return;
    }

    setLoading(true);
    try {
      const location = await Location.getCurrentPositionAsync({});

      /**
       * The start is saved on the phone first and then sent (see
       * services/offlineTrips). With signal this is one request that creates
       * the trip and its photographs together, as before. Without signal the
       * trip begins here and is sent automatically once the phone is back
       * online. Every send carries the same clientRef, so a retry after a
       * dropped connection can never create a second trip.
       */
      // Recorded with the trip so the office can see where it was headed.
      // Read from the phone, never the network, so a weak signal cannot hold
      // up the start; the live socket keeps this copy current.
      const destination = await getSavedDestination();
      const outcome = await submitStart({
        destinationAddress: destination?.address ?? null,
        vehicle: {
          id: assignedVehicle.id,
          plateNumber: assignedVehicle.plateNumber,
          make: assignedVehicle.make,
          model: assignedVehicle.model,
        },
        startedAt: new Date().toISOString(),
        startOdometer: odometerValue,
        startLatitude: location.coords.latitude,
        startLongitude: location.coords.longitude,
        photos: {
          license_plate: keepPhoto(licensePlatePhoto, 'license_plate'),
          driver_selfie: keepPhoto(selfiePhoto, 'driver_selfie'),
          start_odometer: keepPhoto(odometerPhoto, 'start_odometer'),
          // Optional: not every trip has a passenger, and a photo of one needs
          // their knowledge. The server stores it with the trip when it is sent.
          ...(passengerPhoto ? { passenger: keepPhoto(passengerPhoto, 'passenger') } : {}),
        },
      });

      if (outcome.status === 'rejected') {
        // The server answered with an error, so no trip was started.
        Alert.alert('Error', outcome.error);
        return;
      }

      const trip =
        outcome.status === 'sent' && outcome.trip
          ? { ...outcome.trip, vehicle: outcome.trip.vehicle ?? assignedVehicle }
          : {
              clientRef: outcome.clientRef,
              pending: true,
              vehicleId: assignedVehicle.id,
              vehicle: assignedVehicle,
              startTime: new Date().toISOString(),
              startOdometer: odometerValue,
            };
      navigation.replace('ActiveTrip', { trip });
    } catch (error: any) {
      Alert.alert('Error', 'Could not start the trip. Check that location is turned on and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loadingVehicle) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!assignedVehicle) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.noVehicleTitle}>No Vehicle Assigned</Text>
        <Text style={styles.noVehicleText}>
          Please contact your dispatcher or admin to get a vehicle assigned to you.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const photoBox = (uri: string | null, label: string, onPress: () => void, testID: string) => (
    <TouchableOpacity style={styles.photoButton} onPress={onPress} testID={testID}>
      {uri ? <Image source={{ uri }} style={styles.photoPreview} /> : <Text style={styles.photoButtonText}>{label}</Text>}
    </TouchableOpacity>
  );

  // One thing at a time: each step has to be done before Next is enabled.
  const steps = [
    {
      title: 'Confirm your vehicle',
      hint: 'This is the vehicle the office assigned to you.',
      ready: true,
      body: (
        <View style={styles.vehicleCard} testID="start-assigned-vehicle">
          <Text style={styles.vehiclePlate}>{assignedVehicle.plateNumber}</Text>
          <Text style={styles.vehicleInfo}>{assignedVehicle.make} {assignedVehicle.model}</Text>
        </View>
      ),
    },
    {
      title: 'Photo of the license plate',
      hint: 'Make sure the whole plate is readable.',
      ready: !!licensePlatePhoto,
      body: photoBox(licensePlatePhoto, 'Tap to take the plate photo', () => takePhoto('license_plate'), 'start-license-plate-photo'),
    },
    {
      title: 'Odometer reading',
      hint: 'Type the reading, then photograph the odometer.',
      ready: odometer.trim() !== '' && !!odometerPhoto,
      body: (
        <View style={{ gap: 12 }}>
          <TextInput
            style={styles.input}
            testID="start-odometer-input"
            placeholder="Enter current odometer"
            placeholderTextColor="#94a3b8"
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="numeric"
          />
          {photoBox(odometerPhoto, 'Tap to take the odometer photo', () => takePhoto('odometer'), 'start-odometer-photo')}
        </View>
      ),
    },
    {
      title: 'Your selfie',
      hint: 'Confirms who is driving.',
      ready: !!selfiePhoto,
      body: photoBox(selfiePhoto, 'Tap to take a selfie', () => takePhoto('selfie'), 'start-selfie-photo'),
    },
    {
      title: 'Passenger photo (optional)',
      hint: 'Only with the passenger\'s knowledge. You can skip this.',
      ready: true,
      body: photoBox(passengerPhoto, 'Tap to take a passenger photo', () => takePhoto('passenger'), 'start-passenger-photo'),
    },
  ];
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <View style={styles.screen}>
      <View style={styles.progressHeader}>
        <Text style={styles.stepCount} testID="start-step-count">Step {step + 1} of {steps.length}</Text>
        <View style={styles.progressTrack}>
          <Animated.View
            testID="start-progress-bar"
            style={[styles.progressFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
          />
        </View>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <Text style={styles.stepTitle} testID="start-step-title">{current.title}</Text>
          <Text style={styles.stepHint}>{current.hint}</Text>
          {current.body}
        </Animated.View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {step > 0 ? (
          <TouchableOpacity style={styles.backStep} onPress={() => goTo(step - 1)} testID="start-step-back">
            <Text style={styles.backStepText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        {last ? (
          <TouchableOpacity style={[styles.startButton, styles.flex]} onPress={startTrip} disabled={loading} testID="start-trip-submit">
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.startButtonText}>Start Trip</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.startButton, styles.flex, !current.ready && styles.disabled]}
            onPress={() => goTo(step + 1)}
            disabled={!current.ready}
            testID="start-step-next"
          >
            <Text style={styles.startButtonText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 32 },
  progressHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 8 },
  stepCount: { fontSize: 13, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#2563eb' },
  stepTitle: { fontSize: 24, fontWeight: '800', color: '#0f172a', letterSpacing: -0.4 },
  stepHint: { fontSize: 15, color: '#64748b', marginTop: 6, marginBottom: 20, lineHeight: 22 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  flex: { flex: 1 },
  disabled: { opacity: 0.4 },
  backStep: { minHeight: 56, paddingHorizontal: 22, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  backStepText: { fontSize: 16, fontWeight: '700', color: '#334155' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f8fafc' },
  noVehicleTitle: { fontSize: 22, fontWeight: '800', color: '#dc2626', marginBottom: 12, letterSpacing: -0.3 },
  noVehicleText: { fontSize: 15, color: '#94a3b8', textAlign: 'center', lineHeight: 24 },
  backButton: { marginTop: 24, backgroundColor: '#2563eb', paddingHorizontal: 30, paddingVertical: 14, borderRadius: 14, shadowColor: '#2563eb', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#64748b', marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  vehicleCard: { backgroundColor: '#eff6ff', borderWidth: 1.5, borderColor: '#93c5fd', borderRadius: 16, padding: 18 },
  vehiclePlate: { fontSize: 22, fontWeight: '800', color: '#1e40af', letterSpacing: -0.3 },
  vehicleInfo: { fontSize: 14, color: '#3b82f6', marginTop: 4, fontWeight: '500' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 16, fontSize: 16, color: '#0f172a' },
  photoButton: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#cbd5e1', borderStyle: 'dashed', borderRadius: 16, height: 240, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  photoButtonText: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
  photoPreview: { width: '100%', height: '100%' },
  startButton: { backgroundColor: '#2563eb', minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#2563eb', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  startButtonText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
});
