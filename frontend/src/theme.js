// EchoVision design tokens. Every screen pulls colors, spacing and type from here.
// Contrast ratios are noted against `surface` (#1C1F3D); body text targets >= 7:1.

export const colors = {
  background: '#12142B',   // deep indigo
  surface:    '#1C1F3D',   // panels, cards, list groups
  surfaceRaised: '#2A2E57', // inputs, pressed rows, chips
  border:     '#3A3F70',

  text:       '#F4F4FA',   // 14.2:1
  textMuted:  '#B8BAD6',   // 8.2:1
  ink:        '#12142B',   // text/icons on accent fills (>= 7.7:1 on every accent)

  primary:    '#A99CFF',   // soft violet, main action + active state (6.6:1; ink on it 7.7:1)
  secondary:  '#8FB8FF',   // calm blue (7.8:1)

  // Setup / sign-up palette: one accent only
  textPrimary:   '#FFFFFF',   // 16.0:1
  textSecondary: '#B8BCD9',   // 8.6:1
  divider:       '#2E3260',
  accent:        '#C4B5FD',   // 8.7:1; the only accent on setup screens
  accentTint:    'rgba(196,181,253,0.14)', // icon tiles (accent glyph on it 6.4:1)
  onAccent:      '#12142B',   // text on accent fills, 9.8:1
  warn:          '#FCD34D',   // notice icon + stripe only

  // App states, reused everywhere (button, chip, badge)
  wake:       '#A99CFF',
  language:   '#A99CFF',
  listening:  '#FF8FA0',   // 7.2:1
  processing: '#FFC857',   // 10.1:1
  speaking:   '#3DD9B4',   // 8.7:1
  followup:   '#8FB8FF',
  navigating: '#FFA94D',   // 8.2:1

  warning:    '#FFC857',
  warningBg:  'rgba(255,200,87,0.10)',
  backdrop:   'rgba(8,9,22,0.75)',  // behind modal sheets

  // Translucent layers over the live camera feed
  panel:      'rgba(30,33,66,0.92)',
  scrim:      'rgba(18,20,43,0.20)',
  focusBox:   'rgba(244,244,250,0.55)',
  shadow:     '#000000',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  gutter: 20, // screen side padding
};

export const radius = {
  sm: 10,
  md: 14,
  notice: 12,
  group: 16,
  lg: 20,
  pill: 999,
};

export const type = {
  title:   { fontSize: 32, fontWeight: '800', lineHeight: 40 },
  heading: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  status:  { fontSize: 20, fontWeight: '600', lineHeight: 28 },
  body:    { fontSize: 18, fontWeight: '400', lineHeight: 26 },
  label:   { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  small:   { fontSize: 16, fontWeight: '600', lineHeight: 22 },

  // Setup screen scale
  display:      { fontSize: 34, fontWeight: '700', lineHeight: 41 },
  greeting:     { fontSize: 20, fontWeight: '500', lineHeight: 26 },
  rowLabel:     { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  rowSecondary: { fontSize: 15, fontWeight: '400', lineHeight: 20 },
  notice:       { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  button:       { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  link:         { fontSize: 16, fontWeight: '500', lineHeight: 21 },
};

export const touch = {
  min: 48,
  mic: 88,
};
