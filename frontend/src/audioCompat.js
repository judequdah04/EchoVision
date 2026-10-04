// audioCompat.js
// Drop-in replacement for `import { Audio } from 'expo-av'`.
// Exposes the same Audio API EchoVision already uses, implemented on expo-audio
// (expo-av is no longer available in Expo Go SDK 57).

import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync as eaSetAudioModeAsync,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
} from 'expo-audio';

// ---------- helpers ----------

// Flatten a preset ({ extension, sampleRate, ios: {...}, android: {...} })
// into the platform-specific options the native recorder expects.
function flattenOptions(preset) {
  const { ios, android, web, ...common } = preset || {};
  if (Platform.OS === 'ios') return { ...common, ...(ios || {}) };
  if (Platform.OS === 'android') return { ...common, ...(android || {}) };
  return { ...common, ...(web || {}) };
}

// Map old expo-av audio-mode keys to expo-audio keys.
function mapAudioMode(mode = {}) {
  const out = {};
  if ('allowsRecordingIOS' in mode) out.allowsRecording = mode.allowsRecordingIOS;
  if ('playsInSilentModeIOS' in mode) out.playsInSilentMode = mode.playsInSilentModeIOS;
  if ('staysActiveInBackground' in mode) out.shouldPlayInBackground = mode.staysActiveInBackground;
  if ('shouldDuckAndroid' in mode) out.interruptionModeAndroid = mode.shouldDuckAndroid ? 'duckOthers' : 'doNotMix';
  if ('playThroughEarpieceAndroid' in mode) out.shouldRouteThroughEarpiece = mode.playThroughEarpieceAndroid;
  return out;
}

// ---------- Recording ----------

class CompatRecording {
  constructor(recorder) {
    this._recorder = recorder;
    this._uri = null;
  }

  static async createAsync(preset = RecordingPresets.HIGH_QUALITY, onStatusUpdate = null) {
    const recorder = new AudioModule.AudioRecorder(flattenOptions(preset));
    await recorder.prepareToRecordAsync();
    recorder.record();
    const recording = new CompatRecording(recorder);
    if (onStatusUpdate) {
      try { onStatusUpdate(await recording.getStatusAsync()); } catch (_) {}
    }
    return { recording, status: await recording.getStatusAsync() };
  }

  async stopAndUnloadAsync() {
    try {
      await this._recorder.stop();
    } catch (_) {}
    this._uri = this._recorder.uri;
    return this.getStatusAsync();
  }

  async stopAsync() {
    return this.stopAndUnloadAsync();
  }

  getURI() {
    return this._uri || this._recorder.uri;
  }

  async getStatusAsync() {
    const s = (this._recorder.getStatus && this._recorder.getStatus()) || {};
    return {
      canRecord: !!s.canRecord,
      isRecording: !!s.isRecording,
      isDoneRecording: !s.isRecording && !!this._uri,
      durationMillis: s.durationMillis || 0,
      uri: this.getURI(),
    };
  }
}

// ---------- Sound ----------

class CompatSound {
  constructor(player) {
    this._player = player;
    this._callback = null;
    this._finished = false;   // remembers a finish that happened before a callback was attached
    this._unloaded = false;
    this._sub = player.addListener('playbackStatusUpdate', (status) => {
      const mapped = CompatSound._map(status);
      if (mapped.didJustFinish) this._finished = true;
      if (this._callback) this._callback(mapped);
    });
  }

  static _map(status = {}) {
    return {
      isLoaded: status.isLoaded !== false,
      isPlaying: !!status.playing,
      didJustFinish: !!status.didJustFinish,
      positionMillis: Math.round((status.currentTime || 0) * 1000),
      durationMillis: Math.round((status.duration || 0) * 1000),
      volume: status.volume,
      isMuted: !!status.mute,
    };
  }

  static async createAsync(source, initialStatus = {}, onStatusUpdate = null) {
    const player = createAudioPlayer(source);
    const sound = new CompatSound(player);
    if (typeof initialStatus.volume === 'number') player.volume = initialStatus.volume;
    if (typeof initialStatus.isMuted === 'boolean') player.muted = initialStatus.isMuted;
    if (onStatusUpdate) sound.setOnPlaybackStatusUpdate(onStatusUpdate);
    if (initialStatus.shouldPlay) player.play();
    return { sound, status: { isLoaded: true } };
  }

  setOnPlaybackStatusUpdate(cb) {
    this._callback = cb;
    // If the clip already finished before the callback was attached, report it now
    // so code waiting on didJustFinish never hangs.
    if (cb && this._finished) {
      cb({ isLoaded: true, isPlaying: false, didJustFinish: true });
    }
  }

  async getStatusAsync() {
    const p = this._player;
    return {
      isLoaded: !!p.isLoaded,
      isPlaying: !!p.playing,
      didJustFinish: this._finished,
      positionMillis: Math.round((p.currentTime || 0) * 1000),
      durationMillis: Math.round((p.duration || 0) * 1000),
      volume: p.volume,
      isMuted: !!p.muted,
    };
  }

  async setVolumeAsync(volume) {
    this._player.volume = volume;
    return this.getStatusAsync();
  }

  async setIsMutedAsync(muted) {
    this._player.muted = muted;
    return this.getStatusAsync();
  }

  async setIsLoopingAsync(loop) {
    this._player.loop = loop;
    return this.getStatusAsync();
  }

  async setRateAsync(rate) {
    try { this._player.setPlaybackRate(rate); } catch (_) {}
    return this.getStatusAsync();
  }

  async setPositionAsync(millis) {
    await this._player.seekTo((millis || 0) / 1000);
    return this.getStatusAsync();
  }

  async playAsync() {
    this._finished = false;
    this._player.play();
    return this.getStatusAsync();
  }

  async replayAsync() {
    this._finished = false;
    try { await this._player.seekTo(0); } catch (_) {}
    this._player.play();
    return this.getStatusAsync();
  }

  async pauseAsync() {
    this._player.pause();
    return this.getStatusAsync();
  }

  async stopAsync() {
    this._player.pause();
    try { await this._player.seekTo(0); } catch (_) {}
    return this.getStatusAsync();
  }

  async unloadAsync() {
    if (this._unloaded) return;
    this._unloaded = true;
    try { this._sub && this._sub.remove(); } catch (_) {}
    try { this._player.remove(); } catch (_) {}
  }
}

// ---------- public API (same shape as expo-av's Audio) ----------

export const Audio = {
  setAudioModeAsync: (mode) => eaSetAudioModeAsync(mapAudioMode(mode)),
  requestPermissionsAsync: () => requestRecordingPermissionsAsync(),
  getPermissionsAsync: () => getRecordingPermissionsAsync(),
  Recording: CompatRecording,
  Sound: CompatSound,
  RecordingOptionsPresets: {
    HIGH_QUALITY: RecordingPresets.HIGH_QUALITY,
    LOW_QUALITY: RecordingPresets.LOW_QUALITY,
  },
};

export default Audio;
