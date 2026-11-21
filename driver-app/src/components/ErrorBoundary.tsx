import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Appearance } from 'react-native';
import { SUPPORT_EMAIL, openLink } from './HelpLinks';

type State = { failed: boolean };

/** Shows a friendly retry screen instead of a blank app if a screen crashes. */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.log('App crashed', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const dark = Appearance.getColorScheme() === 'dark';
    const text = dark ? '#f1f5f9' : '#0f172a';
    const muted = dark ? '#a3b1c6' : '#55657a';
    return (
      <View style={[styles.wrap, { backgroundColor: dark ? '#0b1220' : '#f8fafc' }]} testID="crash-screen">
        <Text style={[styles.title, { color: text }]}>Something went wrong</Text>
        <Text style={[styles.body, { color: muted }]}>
          Your trips saved on this phone are safe. Tap below to try again.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => this.setState({ failed: false })} testID="crash-retry">
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => openLink(`mailto:${SUPPORT_EMAIL}`)} testID="crash-email">
          <Text style={[styles.linkText, { color: muted }]}>Still stuck? Email {SUPPORT_EMAIL}</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 16, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: '#2563eb', borderRadius: 14, minHeight: 52, paddingHorizontal: 32, justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  link: { minHeight: 44, justifyContent: 'center', marginTop: 12 },
  linkText: { fontSize: 14, textDecorationLine: 'underline' },
});
