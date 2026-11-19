import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { discardItem, loadQueue, subscribeToQueue, syncNow, type QueuedItem } from '../services/offlineTrips';

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

const describe = (item: QueuedItem) =>
  item.kind === 'start'
    ? `Trip start · ${item.vehicle.plateNumber || 'Vehicle'} · ${fmt(item.startedAt)}`
    : `Trip end · ${item.vehicle?.plateNumber || 'Vehicle'} · ${fmt(item.endedAt)}`;

/**
 * Trips saved on the phone that have not reached the office yet. Hidden when
 * there are none. A trip the server refused holds the queue (so nothing is
 * sent out of order) until the driver discards it.
 */
export default function PendingTrips() {
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadQueue().then(setQueue);
    return subscribeToQueue(setQueue);
  }, []);

  if (queue.length === 0) return null;

  const sendNow = async () => {
    setSending(true);
    await syncNow();
    setQueue(await loadQueue());
    setSending(false);
  };

  return (
    <View style={styles.card} testID="pending-trips-card">
      <Text style={styles.title} testID="pending-trips-count">
        {queue.length === 1 ? '1 update waiting to send' : `${queue.length} updates waiting to send`}
      </Text>
      <Text style={styles.sub}>Saved on this phone. Sent automatically when you are back online.</Text>

      {queue.map((item) => (
        <View key={item.clientRef} style={styles.row} testID={`pending-item-${item.clientRef}`}>
          <Text style={styles.rowText}>{describe(item)}</Text>
          {item.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText} testID={`pending-item-error-${item.clientRef}`}>
                Not accepted: {item.error}
              </Text>
              <TouchableOpacity
                style={styles.discardBtn}
                onPress={() => discardItem(item.clientRef)}
                testID={`pending-item-discard-${item.clientRef}`}
              >
                <Text style={styles.discardText}>Discard</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}

      <TouchableOpacity style={styles.sendBtn} onPress={sendNow} disabled={sending} testID="pending-trips-send-now">
        {sending ? <ActivityIndicator color="#92400e" /> : <Text style={styles.sendText}>Send now</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 16, padding: 16, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700', color: '#92400e' },
  sub: { fontSize: 13, color: '#b45309', marginTop: 4, marginBottom: 8 },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#fde68a' },
  rowText: { fontSize: 14, color: '#78350f', fontWeight: '500' },
  errorBox: { marginTop: 6 },
  errorText: { fontSize: 13, color: '#b91c1c' },
  discardBtn: { alignSelf: 'flex-start', marginTop: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#fee2e2', minHeight: 44, justifyContent: 'center' },
  discardText: { color: '#b91c1c', fontWeight: '700', fontSize: 14 },
  sendBtn: { marginTop: 10, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#92400e', fontWeight: '700', fontSize: 15 },
});
