import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useStyles, type Palette } from '../theme';
import { QUICK_REPLIES, fetchNotes, replyToNote, subscribeToNotes, type Note } from '../services/notes';

const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Notes from the office, newest last. The driver answers with a quick reply, which clears it. */
export default function NotesCard() {
  const styles = useStyles(makeStyles);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sending, setSending] = useState<number | null>(null);
  const [failed, setFailed] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToNotes(setNotes);
    fetchNotes();
    return unsubscribe;
  }, []);

  const reply = async (id: number, text: string) => {
    setSending(id);
    setFailed(null);
    if (!(await replyToNote(id, text))) setFailed(id);
    setSending(null);
  };

  if (!notes.length) return null;
  return (
    <View style={styles.card} testID="notes-card">
      <Text style={styles.label}>Message from the office</Text>
      {notes.map((n, i) => (
        <View key={n.id} style={[styles.note, i > 0 && styles.divider]} testID={`note-${n.id}`}>
          <Text style={styles.message}>{n.message}</Text>
          <Text style={styles.meta}>{(n.sentByName || 'Dispatcher') + ' · ' + time(n.createdAt)}</Text>
          <View style={styles.replies}>
            {QUICK_REPLIES.map((r, j) => (
              <TouchableOpacity
                key={r}
                style={[styles.button, j === 0 ? styles.primary : styles.secondary]}
                onPress={() => reply(n.id, r)}
                disabled={sending === n.id}
                testID={j === 0 ? `note-ack-${n.id}` : `note-reply-${n.id}-${r.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <Text style={j === 0 ? styles.primaryText : styles.secondaryText}>{r}</Text>
              </TouchableOpacity>
            ))}
            {sending === n.id ? <ActivityIndicator /> : null}
          </View>
          {failed === n.id ? (
            <Text style={styles.error} testID={`note-reply-error-${n.id}`}>No signal — reply not sent. Try again.</Text>
          ) : null}
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
  replies: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  button: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center' },
  primary: { backgroundColor: c.inverse },
  primaryText: { color: c.onInverse, fontSize: 15, fontWeight: '700' },
  secondary: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderStrong },
  secondaryText: { color: c.text, fontSize: 15, fontWeight: '600' },
  error: { marginTop: 6, fontSize: 13, color: c.dangerText },
});
