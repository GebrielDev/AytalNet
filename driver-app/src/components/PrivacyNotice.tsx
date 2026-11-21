import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStyles, type Palette } from '../theme';
import { PRIVACY_URL, openLink } from './HelpLinks';

const SEEN_KEY = 'privacyNoticeSeen:v1';

/** Shown once on first launch: what the app collects and why. */
export default function PrivacyNotice() {
  const styles = useStyles(makeStyles);
  const [show, setShow] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY).then((v) => setShow(!v));
  }, []);

  const close = () => {
    AsyncStorage.setItem(SEEN_KEY, new Date().toISOString());
    setShow(false);
  };

  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="privacy-notice">
          <Text style={styles.title}>Before you start</Text>
          <Text style={styles.item}>
            <Text style={styles.bold}>Location</Text> — only while a trip is open, to record your route and confirm arrival at your stops.
          </Text>
          <Text style={styles.item}>
            <Text style={styles.bold}>Photos</Text> — odometer, plate and selfie you take for each trip, kept with your trip records.
          </Text>
          <Text style={styles.item}>Only your company's dispatchers and admins can see this. Nothing is sold or used for ads.</Text>
          <TouchableOpacity style={styles.link} onPress={() => openLink(PRIVACY_URL)} testID="privacy-notice-policy">
            <Text style={styles.linkText}>Read the Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={close} testID="privacy-notice-ok">
            <Text style={styles.buttonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: c.text, marginBottom: 14 },
  item: { fontSize: 15, lineHeight: 22, color: c.textSoft, marginBottom: 10 },
  bold: { fontWeight: '700', color: c.text },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 15, fontWeight: '600', color: c.primaryText, textDecorationLine: 'underline' },
  button: { backgroundColor: c.primary, minHeight: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
