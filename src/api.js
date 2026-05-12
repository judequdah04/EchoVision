import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { ENDPOINTS, WS_BASE_URL, API_BASE_URL } from './config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

// ── User ID ───────────────────────────────────────────────────────────────────
// Generated once on first launch, persisted in AsyncStorage forever
let _userId = null;

export async function getUserId() {
  if (_userId) return _userId;
  let stored = await AsyncStorage.getItem('ev_user_id');
  if (!stored) {
    stored = uuidv4();
    await AsyncStorage.setItem('ev_user_id', stored);
  }
  _userId = stored;
  return _userId;
}

// ── Audio ─────────────────────────────────────────────────────────────────────
export async function playAudioBase64(base64Audio) {
  if (!base64Audio) return;
  try {
    const uri = FileSystem.cacheDirectory + 'response_audio.mp3';
    await FileSystem.writeAsStringAsync(uri, base64Audio, { encoding: 'base64' });
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
    });
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, volume: 1.0, isMuted: false }
    );
    await sound.setVolumeAsync(1.0);
    await new Promise((resolve) => {
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.didJustFinish || s.error) {
          sound.unloadAsync();
          resolve();
        }
      });
    });
  } catch (err) {
    console.error('Audio playback error:', err);
  }
}

export async function textToSpeech(text, language = 'english') {
  const res = await fetch(`${API_BASE_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  return res.json();
}

export async function speechToText(recordingUri, languageCode = 'en') {
  const audio_b64 = await FileSystem.readAsStringAsync(recordingUri, { encoding: 'base64' });
  const res = await fetch(ENDPOINTS.stt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_b64, language_code: languageCode }),
  });
  const data = await res.json();
  return data.transcript;
}

export async function describe(frames, language) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.describe, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, language, user_id }),
  });
  return res.json();
}

export async function recognize(frames, language) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.recognize, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, language, user_id }),
  });
  return res.json();
}

export async function identify(item_name, location, language) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.identify, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, location, language, user_id }),
  });
  return res.json();
}

export async function whereIsItem(item_name, language) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.where, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, language, user_id }),
  });
  return res.json();
}

export async function checkRegistered(item_name) {
  const user_id = await getUserId();
  const res = await fetch(`${API_BASE_URL}/check_registered`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, user_id }),
  });
  return res.json();
}

export async function findScan(item_name, frame, language, scan_attempt = 1) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.findScan, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, frame: frame || '', language, scan_attempt, user_id }),
  });
  return res.json();
}

export async function registerFace(name, frames) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.registerFace, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, frames, user_id }),
  });
  return res.json();
}

export async function stickerSetup(color, shape) {
  const user_id = await getUserId();
  const res = await fetch(ENDPOINTS.stickerSetup, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color, shape, user_id }),
  });
  return res.json();
}

export async function getStickerProfile() {
  const user_id = await getUserId();
  const res = await fetch(`${API_BASE_URL}/sticker/profile?user_id=${user_id}`);
  return res.json();
}

export async function openFindWalkWS() {
  const user_id = await getUserId();
  return { ws: new WebSocket(`${WS_BASE_URL}/find/walk`), user_id };
}