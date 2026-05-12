// src/api.js — All API calls + audio playback helper
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { ENDPOINTS, WS_BASE_URL } from './config';

export async function playAudioBase64(base64Audio) {
  if (!base64Audio) return;
  try {
    const uri = FileSystem.cacheDirectory + 'response_audio.mp3';
    await FileSystem.writeAsStringAsync(uri, base64Audio, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const { sound } = await Audio.Sound.createAsync({ uri });
    await sound.playAsync();
    await new Promise((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
          resolve();
        }
      });
    });
  } catch (err) {
    console.error('Audio playback error:', err);
  }
}

export async function speechToText(recordingUri, languageCode = 'en-US') {
  const audio_b64 = await FileSystem.readAsStringAsync(recordingUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const res = await fetch(ENDPOINTS.stt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_b64, language_code: languageCode }),
  });
  const data = await res.json();
  return data.transcript;
}

export async function processCommand(transcript, language, frames) {
  const res = await fetch(ENDPOINTS.processCommand, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, language, frames, frame: frames[0] }),
  });
  return res.json();
}

export async function describe(frames, language) {
  const res = await fetch(ENDPOINTS.describe, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, language }),
  });
  return res.json();
}

export async function recognize(frames, language) {
  const res = await fetch(ENDPOINTS.recognize, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, language }),
  });
  return res.json();
}

export async function identify(item_name, location, language) {
  const res = await fetch(ENDPOINTS.identify, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, location, language }),
  });
  return res.json();
}

export async function whereIsItem(item_name, language) {
  const res = await fetch(ENDPOINTS.where, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, language }),
  });
  return res.json();
}

export async function findScan(item_name, frames, language) {
  const res = await fetch(ENDPOINTS.findScan, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name, frames, language }),
  });
  return res.json();
}

export async function registerFace(name, frames) {
  const res = await fetch(ENDPOINTS.registerFace, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, frames }),
  });
  return res.json();
}

export async function stickerSetup(color, shape) {
  const res = await fetch(ENDPOINTS.stickerSetup, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color, shape }),
  });
  return res.json();
}

export function openFindWalkWS() {
  const ws = new WebSocket(`${WS_BASE_URL}/find/walk`);
  return ws;
}

export async function textToSpeech(text, language) {
  const res = await fetch(ENDPOINTS.tts || `${WS_BASE_URL.replace('wss','https').replace('ws','http')}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  return res.json();
}