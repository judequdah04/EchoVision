// EchoVisionLogo.js
// EchoVision logo for the dark theme: transparent vector mark + wordmark.
// Requires react-native-svg:  npx expo install react-native-svg
//
// Usage:
//   import EchoVisionLogo from '../components/EchoVisionLogo';
//   <EchoVisionLogo />                  // mark + wordmark + tagline, centered
//   <EchoVisionLogo showTagline={false} />
//   <EchoVisionLogo markWidth={120} />

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Circle, Rect } from 'react-native-svg';

const COLORS = {
  text: '#FFFFFF',
  accent: '#C4B5FD',
  textSecondary: '#B8BCD9',
};

export function EchoVisionMark({ width = 150 }) {
  const height = (width * 190) / 320;
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 320 190"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id="evLid" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#60A5FA" />
          <Stop offset="1" stopColor="#C4B5FD" />
        </LinearGradient>
        <LinearGradient id="evPupil" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#60A5FA" />
          <Stop offset="1" stopColor="#7C6CF0" />
        </LinearGradient>
        <LinearGradient id="evBars" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A5B4FC" />
          <Stop offset="1" stopColor="#7C83E8" />
        </LinearGradient>
      </Defs>

      {/* Eye lids */}
      <Path d="M18,115 C70,40 190,18 248,88 C200,62 92,72 18,115 Z" fill="url(#evLid)" />
      <Path d="M18,115 C80,178 190,198 246,140 C186,162 92,152 18,115 Z" fill="url(#evLid)" />

      {/* Pupil + highlight */}
      <Circle cx="148" cy="112" r="37" fill="url(#evPupil)" />
      <Circle cx="165" cy="99" r="12" fill="#FFFFFF" />

      {/* Sparkle */}
      <Path d="M242,8 Q246,31 268,35 Q246,39 242,62 Q238,39 216,35 Q238,31 242,8 Z" fill="#C4B5FD" />

      {/* Sound bars */}
      <Rect x="229" y="95" width="14" height="45" rx="7" fill="url(#evBars)" />
      <Rect x="258" y="70" width="14" height="85" rx="7" fill="url(#evBars)" />
      <Rect x="287" y="86" width="14" height="60" rx="7" fill="url(#evBars)" />
    </Svg>
  );
}

export default function EchoVisionLogo({ markWidth = 150, showTagline = true, style }) {
  return (
    <View
      style={[styles.wrap, style]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={
        showTagline
          ? 'EchoVision. AI assistant for a more independent tomorrow'
          : 'EchoVision'
      }
    >
      <EchoVisionMark width={markWidth} />
      <Text
        style={styles.wordmark}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        maxFontSizeMultiplier={1.6}
      >
        Echo<Text style={styles.wordmarkAccent}>Vision</Text>
      </Text>
      {showTagline ? (
        <Text style={styles.tagline} maxFontSizeMultiplier={1.8}>
          AI assistant for a more independent tomorrow
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  wordmark: {
    marginTop: 12,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  wordmarkAccent: {
    color: COLORS.accent,
  },
  tagline: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});
