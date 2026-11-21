import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';

export const PRIVACY_URL = 'https://driverapp.startechsolutions.us/privacy';
export const WEBSITE_URL = 'https://driverapp.startechsolutions.us/';
export const SUPPORT_EMAIL = 'support@startechsolutions.us';

/** Privacy policy, help email and website links (required for store review). */
/** Opens a link; if no app can handle it (e.g. no mail app), shows the support email instead. */
export function openLink(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Need help?', `Email us at ${SUPPORT_EMAIL}`));
}

export default function HelpLinks({ color }: { color: string }) {
  const links = [
    { label: 'Privacy Policy', url: PRIVACY_URL, id: 'privacy' },
    { label: 'Help', url: `mailto:${SUPPORT_EMAIL}?subject=STS%20Driver%20App%20help`, id: 'help' },
    { label: 'Website', url: WEBSITE_URL, id: 'website' },
  ];
  return (
    <View style={styles.row}>
      {links.map((l) => (
        <TouchableOpacity key={l.id} style={styles.link} onPress={() => openLink(l.url)} testID={`link-${l.id}`}>
          <Text style={[styles.text, { color }]}>{l.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: 24, gap: 8 },
  link: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
