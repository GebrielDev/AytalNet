import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useColors, useStyles, type Palette } from '../theme';
import PendingTrips from '../components/PendingTrips';
import HelpLinks from '../components/HelpLinks';
import StopsCard from '../components/StopsCard';
import { getActiveTrip, getAssignedVehicle, getStops, getRecentTrips, subscribeToStops, type Stop, loadQueue, subscribeToQueue, type TripHistory } from '../services/offlineTrips';

export default function HomeScreen() {
  const { driver, logout } = useAuth();
  const styles = useStyles(makeStyles);
  const c = useColors();
  const navigation = useNavigation<any>();
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [recentTrips, setRecentTrips] = useState<any[]>([]);
  const [history, setHistory] = useState<Omit<TripHistory, 'trips'>>({ offline: false, savedAt: null });
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<Stop[]>([]);

  const route = useRoute<any>();
  const notice: string | undefined = route.params?.notice;

  // Falls back to what is saved on the phone when there is no signal, so a
  // driver out of coverage still sees their trip in progress.
  const loadData = async () => {
    setLoading(true);
    // The vehicle is fetched here too so Start Trip still knows it if the
    // signal drops before the driver opens that screen.
    const [active, recent, , myStops] = await Promise.all([getActiveTrip(), getRecentTrips(), getAssignedVehicle(), getStops()]);
    setStops(myStops);
    setActiveTrip(active);
    setRecentTrips(recent.trips);
    setHistory({ offline: recent.offline, savedAt: recent.savedAt });
    setLoading(false);
  };

  useFocusEffect(
    useCallback(function onFocus() {
      loadData();
    }, [])
  );

  useEffect(() => subscribeToStops(setStops), []);

  // A trip sent in the background moves from "waiting" to completed, and the
  // "will be sent" notice goes once nothing is waiting.
  useEffect(() => subscribeToQueue((queue) => {
    if (queue.length === 0) navigation.setParams({ notice: undefined });
    Promise.all([getActiveTrip(), getRecentTrips()]).then(([active, recent]) => {
      setActiveTrip(active);
      setRecentTrips(recent.trips);
      setHistory({ offline: recent.offline, savedAt: recent.savedAt });
    });
  }), []);

  var handleLogout = async function () {
    const waiting = (await loadQueue()).length;
    if (Platform.OS === 'web') {
      logout();
      return;
    }
    Alert.alert('Logout', waiting
      ? 'Some trips have not been sent yet. They stay on this phone and are sent when you sign in again. Logout now?'
      : 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: logout, style: 'destructive' },
    ]);
  };

  var fmtDate = function (d: string) {
    try {
      var dt = new Date(d);
      var m = dt.getMonth() + 1;
      var day = dt.getDate();
      var y = dt.getFullYear();
      return m + '/' + day + '/' + y;
    } catch (_e) {
      return '-';
    }
  };

  var fmtTime = function (d: string) {
    try {
      var dt = new Date(d);
      var h = dt.getHours();
      var min = dt.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
      var minStr = min < 10 ? '0' + min : '' + min;
      return h + ':' + minStr + ' ' + ampm;
    } catch (_e) {
      return '-';
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  var driverName = 'Driver';
  if (driver && driver.name) { driverName = driver.name; }
  var driverId = '-';
  if (driver && driver.employeeId) { driverId = driver.employeeId; }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{'Hello, ' + driverName}</Text>
          <Text style={styles.sub}>{'ID: ' + driverId}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} testID="home-logout-button">
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {notice ? (
        <View style={styles.noticeBanner} testID="home-notice">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <PendingTrips />

      <StopsCard stops={stops} />

      {activeTrip ? (
        <TouchableOpacity
          testID="home-active-trip-banner"
          style={styles.activeBanner}
          onPress={function () { navigation.navigate('ActiveTrip', { trip: activeTrip }); }}
        >
          <View style={styles.activeDot} />
          <View style={styles.bannerBody}>
            <Text style={styles.activeTitle}>Trip in Progress</Text>
            <Text style={styles.activeSub}>
              {(activeTrip.vehicle && activeTrip.vehicle.plateNumber ? activeTrip.vehicle.plateNumber : 'Vehicle') + ' - started ' + fmtTime(activeTrip.startTime)}
            </Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        testID="home-start-trip-button"
        style={activeTrip ? styles.newTripBtnDisabled : styles.newTripBtn}
        onPress={function () {
          if (!activeTrip) {
            navigation.navigate('StartTrip');
          } else {
            Alert.alert('Active Trip', 'Please end your current trip first.');
          }
        }}
      >
        <Text style={[styles.newTripBtnText, activeTrip && styles.newTripBtnTextDisabled]}>{activeTrip ? 'End Current Trip First' : '+ Start New Trip'}</Text>
      </TouchableOpacity>

      <View style={styles.historyHeader}>
        <Text style={styles.sectionTitle}>Completed Trips</Text>
        <TouchableOpacity style={styles.historyLink} onPress={function () { navigation.navigate('TripHistory'); }} testID="home-trip-history-button">
          <Text style={styles.historyLinkText}>Last 30 days ›</Text>
        </TouchableOpacity>
        {recentTrips.length > 0 ? (
          <Text style={styles.totalMiles} testID="home-history-total-miles">
            {recentTrips.reduce(function (sum: number, t: any) { return sum + (Number(t.totalMileage) || 0); }, 0).toFixed(1).replace(/\.0$/, '') + ' mi · last ' + recentTrips.length + ' trips'}
          </Text>
        ) : null}
      </View>

      {history.offline ? (
        <View style={styles.offlineBanner} testID="home-history-offline-banner">
          <Text style={styles.offlineText}>
            {'No signal - showing trips saved on this phone' + (history.savedAt ? ' (updated ' + fmtDate(history.savedAt) + ' ' + fmtTime(history.savedAt) + ')' : '') + '.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.thDate}>Date</Text>
          <Text style={styles.thVehicle}>Vehicle</Text>
          <Text style={styles.thDur}>Duration</Text>
          <Text style={styles.thMiles}>Miles</Text>
        </View>

        {recentTrips.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No completed trips yet</Text>
          </View>
        ) : null}

        {recentTrips.map(function (t: any, i: number) {
          var plate = '-';
          if (t.vehicle && t.vehicle.plateNumber) { plate = t.vehicle.plateNumber; }
          var makeModel = '';
          if (t.vehicle && t.vehicle.make) { makeModel = t.vehicle.make + ' ' + (t.vehicle.model || ''); }
          var dur = '-';
          if (t.durationMinutes != null) { dur = t.durationMinutes + ' min'; }
          var miles = '-';
          if (t.totalMileage != null) { miles = Number(t.totalMileage).toFixed(1).replace(/\.0$/, ''); }

          var rowStyle = i % 2 === 0 ? styles.rowEven : styles.rowOdd;
          var key = t.id ? String(t.id) : String(i);

          return (
            <View key={key} style={rowStyle} testID={'home-completed-trip-' + key}>
              <View style={styles.colDate}>
                <Text style={styles.cellMain}>{fmtDate(t.endTime)}</Text>
                {t.pending ? <Text style={styles.pendingTag} testID={'home-history-' + key}>Waiting to send</Text> : null}
                <Text style={styles.cellSub}>{fmtTime(t.startTime) + ' - ' + fmtTime(t.endTime)}</Text>
              </View>
              <View style={styles.colVehicle}>
                <Text style={styles.cellMain}>{plate}</Text>
                <Text style={styles.cellSub} numberOfLines={1}>{makeModel}</Text>
              </View>
              <View style={styles.colDur}>
                <Text style={styles.cellMain}>{dur}</Text>
              </View>
              <View style={styles.colMiles}>
                <Text style={styles.cellMain}>{miles}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <HelpLinks color={c.textMuted} />
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.bg },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingTop: 4 },
  greeting: { fontSize: 24, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: c.textMuted, marginTop: 3, fontWeight: '500' },
  logoutBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  logoutText: { color: c.dangerText, fontSize: 15, fontWeight: '700' },

  noticeBanner: { backgroundColor: c.primarySoft, borderWidth: 1, borderColor: c.primaryBorder, borderRadius: 14, padding: 14, marginBottom: 16 },
  noticeText: { fontSize: 14, color: c.primaryText, fontWeight: '600' },
  activeBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.successSoft, borderWidth: 1, borderColor: c.successBorder, borderRadius: 16, padding: 16, marginBottom: 16 },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e', marginRight: 14 },
  bannerBody: { flex: 1 },
  activeTitle: { fontSize: 16, fontWeight: '700', color: c.successText },
  activeSub: { fontSize: 13, color: c.successText, marginTop: 2 },

  newTripBtn: { backgroundColor: c.primary, paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 28, shadowColor: '#2563eb', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  newTripBtnDisabled: { backgroundColor: c.primaryDisabled, paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 28 },
  newTripBtnTextDisabled: { color: c.textSoft },
  newTripBtnText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },

  sectionTitle: { fontSize: 17, fontWeight: '700', color: c.text, letterSpacing: -0.2 },
  historyHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 4 },
  historyLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  historyLinkText: { fontSize: 15, fontWeight: '700', color: c.primaryText },
  totalMiles: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  offlineBanner: { backgroundColor: c.border, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: c.border },
  offlineText: { fontSize: 13, color: c.textSoft },
  pendingTag: { fontSize: 10, fontWeight: '700', color: c.warnText, marginTop: 2 },

  table: { backgroundColor: c.card, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: c.bg, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  thDate: { flex: 1.2, fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  thVehicle: { flex: 1, fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  thDur: { flex: 0.7, fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  thMiles: { flex: 0.6, fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  rowEven: { flexDirection: 'row', backgroundColor: c.card, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  rowOdd: { flexDirection: 'row', backgroundColor: c.bg, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  colDate: { flex: 1.2, paddingRight: 4 },
  colVehicle: { flex: 1, paddingRight: 4, overflow: 'hidden' },
  colDur: { flex: 0.7, justifyContent: 'center' },
  colMiles: { flex: 0.6, alignItems: 'flex-end', justifyContent: 'center' },
  cellMain: { fontSize: 13, fontWeight: '600', color: c.text },
  cellSub: { fontSize: 10, color: c.textMuted, marginTop: 2 },

  emptyRow: { padding: 30, alignItems: 'center' },
  emptyText: { fontSize: 15, color: c.textMuted },
});
