import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useStyles, type Palette } from '../theme';
import { acknowledgeNote, fetchNotes, subscribeToNotes, type Note } from '../services/notes';

const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Notes from the office, newest last. Each stays until the driver taps "Got it". */
export default function NotesCard() {
  const styles = useStyles(makeStyles);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToNotes(setNotes);
    fetchNotes();
    return unsubscribe;
  }, []);

  if (!notes.length) return null;
  return (
    <View style={styles.card} testID="notes-card">
      <Text style={styles.label}>Message from the office</Text>
      {notes.map((n, i) => (
        <View key={n.id} style={[styles.note, i > 0 && styles.divider]} testID={`note-${n.id}`}>
          <Text style={styles.message}>{n.message}</Text>
          <Text style={styles.meta}>{(n.sentByName || 'Dispatcher') + ' · ' + time(n.createdAt)}</Text>
          <TouchableOpacity style={styles.button} onPress={() => acknowledgeNote(n.id)} testID={`note-ack-${n.id}`}>
            <Text style={styles.buttonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  card: { backgroundColor: c.warnSoft, borderWidth: 1, borderColor: c.warnBorder, borderRadius: 16, padding: 16, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: c.warnText, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  note: { paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: c.warnBorder },
  message: { fontSize: 17, fontWeight: '600', color: c.text, lineHeight: 23 },
  meta: { fontSize: 13, color: c.textMuted, marginTop: 4 },
  button: { alignSelf: 'flex-start', marginTop: 10, minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: c.inverse, justifyContent: 'center' },
  buttonText: { color: c.onInverse, fontSize: 15, fontWeight: '700' },
});
