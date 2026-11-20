import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

// Colours for the driver app. Dark follows the phone's setting for night shifts.
const light = {
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  text: '#0f172a',
  textSoft: '#334155',
  textMuted: '#55657a',
  placeholder: '#64748b',
  primary: '#2563eb',
  primaryDisabled: '#cbd5e1',
  primarySoft: '#eff6ff',
  primaryBorder: '#bfdbfe',
  primaryText: '#1e40af',
  inverse: '#0f172a',
  onInverse: '#ffffff',
  successSoft: '#ecfdf5',
  successBorder: '#86efac',
  successText: '#166534',
  warnSoft: '#fffbeb',
  warnBorder: '#fcd34d',
  warnText: '#92400e',
  dangerSoft: '#fee2e2',
  dangerText: '#b91c1c',
  header: '#2563eb',
  danger: '#dc2626',
  success: '#047857',
  isDark: false,
};

export type Palette = typeof light;

const dark: Palette = {
  bg: '#0b1220',
  card: '#131c2e',
  border: '#253047',
  borderStrong: '#3a4760',
  text: '#f1f5f9',
  textSoft: '#d5dde8',
  textMuted: '#a3b1c6',
  placeholder: '#7c8aa0',
  primary: '#2563eb',
  primaryDisabled: '#334155',
  primarySoft: 'rgba(59,130,246,0.16)',
  primaryBorder: 'rgba(59,130,246,0.4)',
  primaryText: '#93c5fd',
  inverse: '#e2e8f0',
  onInverse: '#0f172a',
  successSoft: 'rgba(34,197,94,0.14)',
  successBorder: 'rgba(34,197,94,0.4)',
  successText: '#86efac',
  warnSoft: 'rgba(245,158,11,0.14)',
  warnBorder: 'rgba(245,158,11,0.45)',
  warnText: '#fcd34d',
  dangerSoft: 'rgba(239,68,68,0.18)',
  dangerText: '#fca5a5',
  header: '#131c2e',
  danger: '#dc2626',
  success: '#047857',
  isDark: true,
};

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Builds a screen's styles from the current palette. */
export function useStyles<T>(make: (c: Palette) => T): T {
  const c = useColors();
  return useMemo(() => make(c), [c, make]);
}
