---
name: accessible-mobile-ui
description: Use when designing or restyling React Native / Expo screens, especially for EchoVision, an app for blind and low-vision users. Covers accessible layout, color, type, touch targets, screen-reader labels, and how to restyle without breaking app logic.
---

# Accessible Mobile UI (React Native + Expo)

You are restyling screens for **EchoVision**, a voice-first AI assistant for blind and low-vision users. Many users will never see the screen; others have partial vision; sighted helpers and evaluators will also use it. The UI must work for all three groups.

## Golden rule: style only, never logic

When asked to change design or UI:
- Change only JSX layout, `StyleSheet` objects, colors, fonts, icons, and accessibility props.
- Do NOT change functions, hooks, refs, state machines, timers, API calls, audio/recording code, camera capture, WebSocket code, or the order of `await` calls.
- Do NOT rename state values, refs, or props that logic depends on (for example `STATES`, `status`, `statusText`, `walkInfo`, `language`).
- Do NOT add or remove `disabled` conditions or `onPress` handlers. Keep existing handlers wired exactly as they are.
- If a visual idea requires a logic change, stop and ask first.

After editing, re-read the diff and confirm that only presentation code changed.

## Process

1. Read all screen files first (`src/screens/*.js`, `App.js`) to understand the flow and the existing states.
2. Propose a short design plan before coding:
   - Palette: 5–7 named hex values with their roles.
   - Type scale: sizes and weights for title, body, status, and labels.
   - Layout: a one-line description plus a small ASCII wireframe per screen.
3. Create a single theme file, `src/theme.js`, exporting `colors`, `spacing`, `radius`, and `type`. Every screen imports from it, with no hard-coded colors left in the screens.
4. Restyle one screen at a time, starting with the most used one (CameraScreen).
5. Summarize what changed per file.

## Accessibility requirements (non-negotiable)

**Contrast**
- Body text and icons: contrast ratio at least 7:1 against their background (WCAG AAA). Large text (24pt+): at least 4.5:1.
- Text over the live camera feed must sit on a solid or near-solid panel (for example 85–90% opacity), never directly on the video.

**Touch targets**
- Every touchable element: at least 48×48 pt, plus `hitSlop` where the visual is smaller.
- The primary action (the mic button) should be very large (110–140 pt) and placed where a thumb naturally rests, bottom center.
- Keep at least 12 pt between neighboring touch targets.

**Text**
- Minimum 16 pt anywhere; 18–20 pt for status and body text; 28+ pt for titles.
- Keep `allowFontScaling` on (the default) so iOS Dynamic Type works; make layouts survive 150% text size without clipping.
- Sentence case, plain words, short sentences. No all-caps labels.

**Screen readers (VoiceOver / TalkBack)**
- Every touchable gets `accessibilityRole`, `accessibilityLabel`, and, where helpful, `accessibilityHint`. Example: the mic button gets label "Talk to Suji" with a hint that describes what tapping does in the current state.
- Status text that changes should use `accessibilityLiveRegion="polite"` (Android) and be announced on iOS via the label of a focused element. Do not add new announcement logic unless asked.
- Decorative views (overlays, focus box, gradients) get `accessible={false}` and `importantForAccessibility="no-hide-descendants"`.
- Do not use emojis as the only way to show meaning: screen readers read them aloud ("ear", "hourglass"). Prefer icons from `@expo/vector-icons` (bundled with Expo) with an accessibility label on the parent.

**State communication**
- Never rely on color alone. Each app state (listening, processing, speaking, navigating, and so on) must differ in at least two of: icon, text label, shape or ring, color.
- Keep state colors consistent across every screen.

**Layout**
- Respect safe areas with `react-native-safe-area-context` (`SafeAreaView` or `useSafeAreaInsets`) so nothing hides under the notch or home indicator.
- One primary action per screen. Secondary actions are smaller and visually quieter.
- Don't cover the center of the camera view; the user aims the camera there.

**Motion**
- Use motion only to show a state change (for example a slow pulse ring while listening). Keep it subtle and short; respect reduced motion via `AccessibilityInfo.isReduceMotionEnabled()` if you add animation.

## Color guidance

- The camera screen sits on top of a live video feed, so it needs dark, solid UI surfaces with a bright, high-contrast accent.
- Choose one brand accent and use it sparingly, for the primary action and the active state only.
- Give each app state one dedicated color and reuse it everywhere (button ring, status chip, badge).
- Avoid pure black (#000) panels next to pure white text over large areas; use a very dark tinted neutral and an off-white for comfort.
- Avoid red/green as the only distinction between states (color-blind users).
- Check every text/background pair for contrast before finalizing.

## Dependencies

- Prefer what the project already has: `@expo/vector-icons`, `react-native-safe-area-context`.
- If a new package is truly needed (for example `expo-linear-gradient`), install it with `npx expo install <package>` so the version matches the Expo SDK, and say so in the summary.

## Before you finish

- No logic changed (re-check the diff).
- No hard-coded colors left in screens; everything comes from `src/theme.js`.
- All touchables have role + label; decorative views are hidden from screen readers.
- Text is at least 16 pt and contrast is at least 7:1 for body text.
- Layout works on a small iPhone (375 pt wide) and with large Dynamic Type.
