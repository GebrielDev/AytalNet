import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform, ActivityIndicator, TextInput, Image } from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useColors, useStyles, type Palette } from '../theme';
import { vehiclesApi } from '../services/api';
import { setStopsLocal, appendPhoto, type Stop } from '../services/offlineTrips';

const encode = (address: string) => encodeURIComponent(address);

// https links: each opens the app when it is installed, the website when not.
const APPS = [
  { key: 'google', label: 'Google Maps', url: (a: string) => `https://www.google.com/maps/dir/?api=1&destination=${encode(a)}&travelmode=driving` },
  ...(Platform.OS === 'ios' ? [{ key: 'apple', label: 'Apple Maps', url: (a: string) => `https://maps.apple.com/?daddr=${encode(a)}&dirflg=d` }] : []),
  { key: 'waze', label: 'Waze', url: (a: string) => `https://waze.com/ul?q=${encode(a)}&navigate=yes` },
];

/** Navigate button for one stop: opens the driver's choice of maps app. */
function NavigateButton({ stop, primary }: { stop: Stop; primary: boolean }) {
  const styles = useStyles(makeStyles);
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

  if (choosing) {
    return (
      <View style={styles.options}>
        {APPS.map((app) => (
          <TouchableOpacity key={app.key} style={styles.option} onPress={() => open(app.url(stop.address))} testID={`navigate-with-${app.key}-${stop.id}`}>
            <Text style={styles.optionText}>{app.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.cancel} onPress={() => setChoosing(false)} testID={`navigate-cancel-${stop.id}`}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }
  return (
    <TouchableOpacity style={primary ? styles.navigate : styles.navigateSmall} onPress={() => setChoosing(true)} testID={`navigate-button-${stop.id}`}>
      <Text style={primary ? styles.navigateText : styles.navigateSmallText}>Navigate</Text>
    </TouchableOpacity>
  );
}

/**
 * "I've arrived": checked against the phone's location by the server. The
 * driver can add the odometer reading and its photo first (optional).
 */
function ArriveButton({ stop }: { stop: Stop }) {
  const styles = useStyles(makeStyles);
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const takePhoto = async () => {
    setMessage('');
    const perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        setMessage('Camera is off for this app. Turn it on in Settings to add a photo.');
        return;
      }
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        setMessage('Camera is needed to photograph the odometer. You can still confirm without it.');
        return;
      }
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const arrive = async () => {
    const reading = odometer.trim();
    if (reading && !(Number.isFinite(Number(reading)) && Number(reading) >= 0)) {
      setMessage('Enter the odometer reading as a number, for example 10432');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' && (await Location.requestForegroundPermissionsAsync()).status !== 'granted') {
        setMessage('Location is needed to confirm you have arrived.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const form = new FormData();
      form.append('latitude', String(position.coords.latitude));
      form.append('longitude', String(position.coords.longitude));
      if (reading) form.append('odometer', reading);
      if (photo) await appendPhoto(form, 'photo', photo, `stop-${stop.id}-odometer.jpg`);
      const res = await vehiclesApi.arriveAtStop(stop.id, form);
      await setStopsLocal(res.data.stops);
    } catch (error: any) {
      setMessage(
        error?.response?.data?.error ||
          (error?.response ? 'Could not confirm arrival.' : 'No signal. Try again when you have signal - the arrival (without the reading and photo) is also recorded if you end the trip here.')
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.arrive} onPress={() => setOpen(true)} testID={`arrive-button-${stop.id}`}>
        <Text style={styles.arriveText}>I've arrived</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.proof} testID={`arrive-panel-${stop.id}`}>
      <Text style={styles.proofLabel}>Odometer at this stop (optional)</Text>
      <TextInput
        style={styles.input}
        value={odometer}
        onChangeText={setOdometer}
        keyboardType="numeric"
        placeholder="e.g. 10432"
        placeholderTextColor={c.placeholder}
        testID={`arrive-odometer-${stop.id}`}
      />
      {photo ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: photo }} style={styles.photo} />
          <TouchableOpacity style={styles.smallBtn} onPress={takePhoto} testID={`arrive-retake-${stop.id}`}>
            <Text style={styles.navigateSmallText}>Retake</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.navigateSmall} onPress={takePhoto} testID={`arrive-photo-${stop.id}`}>
          <Text style={styles.navigateSmallText}>Take odometer photo (optional)</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.confirm} onPress={arrive} disabled={busy} testID={`arrive-confirm-${stop.id}`}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Confirm arrival</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)} disabled={busy} testID={`arrive-cancel-${stop.id}`}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
      {message ? <Text style={styles.error} testID={`arrive-message-${stop.id}`}>{message}</Text> : null}
    </View>
  );
}

/**
 * The driver's job: stops in the order the dispatcher set. The next stop is
 * highlighted with Navigate and "I've arrived"; later stops have their own
 * Navigate button; reached stops are ticked off.
 */
export default function StopsCard({ stops }: { stops: Stop[] }) {
  const styles = useStyles(makeStyles);
  if (!stops.length) return null;
  const nextId = stops.find((s) => !s.arrivedAt)?.id;
  const remaining = stops.filter((s) => !s.arrivedAt).length;

  return (
    <View style={styles.card} testID="stops-card">
      <Text style={styles.label} testID="stops-summary">
        {remaining ? `Stops · ${remaining} to go` : 'All stops reached'}
      </Text>
      {stops.map((stop, i) => {
        const isNext = stop.id === nextId;
        return (
          <View key={stop.id} style={[styles.stop, i > 0 && styles.stopDivider]} testID={`stop-${stop.id}`}>
            <View style={styles.stopHeader}>
              <View style={[styles.badge, stop.arrivedAt ? styles.badgeDone : isNext ? styles.badgeNext : null]}>
                <Text style={[styles.badgeText, (stop.arrivedAt || isNext) && styles.badgeTextOn]}>{stop.arrivedAt ? '✓' : i + 1}</Text>
              </View>
              <View style={styles.stopBody}>
                <Text style={[styles.address, stop.arrivedAt && styles.addressDone, isNext && styles.addressNext]} testID={`stop-address-${stop.id}`}>
                  {stop.address}
                </Text>
                {stop.note ? <Text style={styles.note}>{stop.note}</Text> : null}
                {stop.arrivedAt ? <Text style={styles.doneText}>{'Arrived' + (stop.arrivedOdometer != null ? ` · ${stop.arrivedOdometer} mi` : '') + (stop.arrivedPhotoUrl ? ' · photo' : '')}</Text> : null}
              </View>
            </View>
            {!stop.arrivedAt ? (
              <View style={styles.actions}>
                <NavigateButton stop={stop} primary={isNext} />
                {isNext ? <ArriveButton stop={stop} /> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.primaryBorder, borderRadius: 16, padding: 16, marginBottom: 16 },
  label: { fontSize: 12, color: c.primaryText, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  stop: { paddingVertical: 10 },
  stopDivider: { borderTopWidth: 1, borderTopColor: c.border },
  stopHeader: { flexDirection: 'row', gap: 10 },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  badgeNext: { backgroundColor: c.primary },
  badgeDone: { backgroundColor: c.success },
  badgeText: { fontSize: 12, fontWeight: '700', color: c.textSoft },
  badgeTextOn: { color: '#fff' },
  stopBody: { flex: 1 },
  address: { fontSize: 15, fontWeight: '600', color: c.textSoft },
  addressNext: { fontSize: 17, fontWeight: '700', color: c.text },
  addressDone: { color: c.textMuted, textDecorationLine: 'line-through' },
  note: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  doneText: { fontSize: 12, color: c.successText, fontWeight: '600', marginTop: 2 },
  proof: { gap: 8, backgroundColor: c.successSoft, borderRadius: 12, padding: 12 },
  proofLabel: { fontSize: 13, fontWeight: '600', color: c.textSoft },
  input: { minHeight: 48, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: c.text, backgroundColor: c.card },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 64, height: 64, borderRadius: 10 },
  smallBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: c.borderStrong, justifyContent: 'center' },
  confirm: { minHeight: 52, borderRadius: 12, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  actions: { marginTop: 10, marginLeft: 36, gap: 8 },
  navigate: { backgroundColor: c.inverse, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navigateText: { color: c.onInverse, fontSize: 16, fontWeight: '700' },
  navigateSmall: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  navigateSmallText: { color: c.text, fontSize: 15, fontWeight: '600' },
  arrive: { minHeight: 48, borderRadius: 12, backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center' },
  arriveText: { color: c.successText, fontSize: 16, fontWeight: '700' },
  options: { gap: 8 },
  option: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  optionText: { fontSize: 15, fontWeight: '600', color: c.text },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, color: c.textMuted, fontWeight: '600' },
  error: { marginTop: 6, fontSize: 13, color: c.dangerText },
});
