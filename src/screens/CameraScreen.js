import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Vibration,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import {
  describe, recognize, identify, whereIsItem,
  findScan, checkRegistered, openFindWalkWS, playAudioBase64, textToSpeech,
} from '../api';
import { API_BASE_URL } from '../config';

const STATES = {
  WAKE_LISTENING:  'wake_listening',
  LANGUAGE_SELECT: 'language_select',
  LISTENING:       'listening',
  PROCESSING:      'processing',
  RESPONDING:      'responding',
  FOLLOWUP:        'followup',
  WALK:            'walk',
};

const FILLER_WORDS = new Set(['um','uh','ah','oh','hmm','hm','eh','the','a','an',
  'and','or','but','so','like','you','know','i','just','okay','ok','mm','mmm',
  'mhm','huh','yeah','yep','nope','no','yes','trails','off']);

const HALLUCINATIONS = ['اشتركوا','القناة','subscribe','subtitles','www.','.com','http',
  'thank you for watching','شكرا للمشاهدة'];

const DELAY = ms => new Promise(r => setTimeout(r, ms));

export default function CameraScreen({ navigation, route }) {
  const initialLanguage = route?.params?.language || null;

  const [status, setStatus]           = useState(STATES.WAKE_LISTENING);
  const [statusText, setStatusText]   = useState('Listening for "Hey Suji"…');
  const [cameraReady, setCameraReady] = useState(false);
  const [walkInfo, setWalkInfo]       = useState('');
  const [language, setLanguage]       = useState(initialLanguage);
  const [camPermission, reqCamPerm]   = useCameraPermissions();

  const cameraRef          = useRef(null);
  const recordingRef       = useRef(null);
  const wsRef              = useRef(null);
  const walkTimerRef       = useRef(null);
  const obstacleTimerRef   = useRef(null);
  const wakeLoopActive     = useRef(false);
  const sessionActive      = useRef(false);
  const lastKeyword        = useRef(null);
  const languageRef        = useRef(initialLanguage);
  const languageAsked      = useRef(initialLanguage !== null);
  const waitingFollowup    = useRef(false);

  const isSpeaking        = useRef(false);
  const audioQueue        = useRef([]);
  const processingQueue   = useRef(false);

  // walk session state
  const excludedBoxesRef  = useRef([]);
  const currentItemRef    = useRef(null);
  const walkUserIdRef     = useRef(null);
  const walkWsRef         = useRef(null);

  async function drainAudioQueue() {
    if (processingQueue.current) return;
    processingQueue.current = true;
    while (audioQueue.current.length > 0) {
      const item = audioQueue.current.shift();
      isSpeaking.current = true;
      try { await playAudioBase64(item.audio); } catch (e) {}
      isSpeaking.current = false;
      await DELAY(300);
    }
    processingQueue.current = false;
  }

  function enqueueAudio(audio, label = 'walk') {
    if (!audio) return;
    if (label === 'obstacle') {
      audioQueue.current.unshift({ audio, label });
    } else {
      const hasObstacle = audioQueue.current.some(i => i.label === 'obstacle');
      if (hasObstacle || isSpeaking.current) return;
      audioQueue.current.push({ audio, label });
    }
    drainAudioQueue();
  }

  useEffect(() => {
    (async () => {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      if (!camPermission?.granted) reqCamPerm();
      setTimeout(() => startWakeLoop(), 800);
    })();
    return () => cleanup();
  }, []);

  function cleanup() {
    wakeLoopActive.current  = false;
    sessionActive.current   = false;
    waitingFollowup.current = false;
    clearInterval(walkTimerRef.current);
    clearInterval(obstacleTimerRef.current);
    wsRef.current?.close();
    stopRecording();
    audioQueue.current      = [];
    isSpeaking.current      = false;
    processingQueue.current = false;
  }

  function stopRecording() {
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
  }

  function getLang() { return languageRef.current || 'english'; }

  async function speak(text, lang) {
    try {
      const res = await textToSpeech(text, lang || 'english');
      if (res?.audio) await playAudioBase64(res.audio);
      await DELAY(300);
    } catch (e) { console.error('speak error:', e); }
  }

  async function safeJson(response) {
    const text = await response.text();
    try { return JSON.parse(text); }
    catch (e) { console.error('JSON parse error:', text.substring(0,100)); return null; }
  }

  async function startWakeLoop() {
    wakeLoopActive.current = true;
    setStatus(STATES.WAKE_LISTENING);
    setStatusText('Listening for "Hey Suji"…');
    wakeListenCycle();
  }

  async function wakeListenCycle() {
    if (!wakeLoopActive.current) return;
    try {
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (e) {}
        recordingRef.current = null;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      await DELAY(200);
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      await DELAY(2000);
      if (!wakeLoopActive.current) {
        await recording.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
        return;
      }
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) {
        if (wakeLoopActive.current) setTimeout(() => wakeListenCycle(), 500);
        return;
      }
      const audio_b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      console.log('Wake audio size:', audio_b64.length);
      const res = await fetch(`${API_BASE_URL}/wake_stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_b64, language_code: 'en' }),
      });
      const data = await safeJson(res);
      console.log('Wake response:', JSON.stringify(data));
      if (data?.wake === true) {
        wakeLoopActive.current = false;
        await onWakeWordDetected();
      } else {
        if (wakeLoopActive.current) wakeListenCycle();
      }
    } catch (err) {
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (e) {}
        recordingRef.current = null;
      }
      if (wakeLoopActive.current) setTimeout(() => wakeListenCycle(), 1000);
    }
  }

  function stopWakeLoop() {
    wakeLoopActive.current = false;
    stopRecording();
  }

  async function onWakeWordDetected() {
    Vibration.vibrate([0, 150, 80, 150]);
    sessionActive.current = true;
    setStatus(STATES.RESPONDING);
    setStatusText('Hey Suji!');
    await speak('Yes, how can I help you?', 'english');
    await startCommandRecording();
  }

  async function startCommandRecording() {
    try {
      setStatus(STATES.LISTENING);
      setStatusText('Listening… say your command');
      await DELAY(400);
      Vibration.vibrate(500);
      await DELAY(600);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setTimeout(() => finishListening(), 5000);
    } catch (err) {
      await resumeWakeLoop();
    }
  }

  async function finishListening() {
    if (!recordingRef.current) return;
    try {
      Vibration.vibrate(100);
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setStatus(STATES.PROCESSING);
      setStatusText('Processing…');
      const audio_b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      console.log('Command audio size:', audio_b64.length);
      const sttRes = await fetch(`${API_BASE_URL}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_b64, language_code: 'en' }),
      });
      const sttData    = await safeJson(sttRes);
      console.log('STT response:', JSON.stringify(sttData));
      const transcript = cleanTranscript(sttData?.transcript || '');
      console.log('Transcript:', transcript);
      await transcribeAndRun(transcript);
    } catch (err) {
      await resumeWakeLoop();
    }
  }

  function cleanTranscript(text) {
    let c = text.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g,'').trim();
    c = c.replace(/\.{2,}/g,'').replace(/^[\.\s]+/,'').replace(/\s+/g,' ').trim();
    const nonLatin = (c.match(/[^\x00-\x7F]/g) || []).length;
    if (nonLatin > c.length * 0.3) return '';
    for (const h of HALLUCINATIONS) {
      if (c.toLowerCase().includes(h.toLowerCase())) return '';
    }
    return c;
  }

  function validateTranscript(text) {
    const lower = text.toLowerCase().trim();
    if (['stop','quit'].includes(lower)) return 'stop';
    if (!text.trim())                    return 'invalid';
    if (/[^\x00-\x7F]/.test(text))      return 'invalid';
    const stripped = text.replace(/[^\w\s]/g,'').trim();
    if (!stripped || /^[\d\s]+$/.test(stripped)) return 'invalid';
    const words = stripped.toLowerCase().split(/\s+/);
    if (words.length < 2)                return 'invalid';
    const meaningful = words.filter(w => !FILLER_WORDS.has(w));
    if (!meaningful.length)              return 'invalid';
    if (new Set(words).size === 1)       return 'invalid';
    return 'valid';
  }

  function parseKeyword(transcript) {
    const text = transcript.toLowerCase();
    for (const kw of ['describe','recognize','identify','where','find','stop','quit']) {
      if (text.includes(kw)) return kw;
    }
    return null;
  }

  function parseObject(transcript) {
    const text = transcript.toLowerCase();
    const patterns = [
      /(?:find|identify|where is|where's)\s+(?:my|the|a|an)?\s*(.+?)(?:\s+in\s+|\s+at\s+|[.,!?]|$)/i,
      /(?:find|identify|where is|where's)\s+(.+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim().replace(/[.,!?;:]+$/,'').trim();
    }
    return null;
  }

  function parseLocation(transcript) {
    const m = transcript.toLowerCase().match(/(?:in|at|on|inside|near|next to)\s+(?:my|the)?\s*(.+?)(?:[.,!?]|$)/i);
    return m ? m[1].trim() : null;
  }

  async function transcribeAndRun(transcript) {
    const lower     = (transcript || '').toLowerCase().trim();
    const stopWords = ['stop','quit','exit','bye'];

    if (waitingFollowup.current) {
      waitingFollowup.current = false;
      if (!transcript || transcript.length < 2) {
        await speak('I did not understand. Please say a command or say stop to exit.', 'english');
        waitingFollowup.current = true;
        await startCommandRecording();
        return;
      }
      const words = lower.split(' ');
      if (words.length <= 3 && stopWords.some(w => words.includes(w))) { await endSession(); return; }
      if (words.length <= 2 && ['no','nope','nothing'].some(w => words.includes(w))) { await endSession(); return; }
      await executeCommand(transcript);
      return;
    }

    if (!transcript || transcript.length < 2) {
      await speak("I didn't hear anything. Please try again.", 'english');
      await startCommandRecording();
      return;
    }

    setStatusText(`Heard: "${transcript}"`);
    const words = lower.split(' ');
    if (words.length <= 4 && stopWords.some(w => words.includes(w))) { await endSession(); return; }
    await executeCommand(transcript);
  }

  async function executeCommand(transcript) {
    const validation = validateTranscript(transcript);
    if (validation === 'stop') { await endSession(); return; }
    if (validation === 'invalid') {
      await speak('I did not understand. Please say one of the following: Describe, Recognize, Identify, Where, or Find.', 'english');
      await startCommandRecording();
      return;
    }

    const keyword = parseKeyword(transcript);
    if (!keyword) {
      await speak('I did not understand. Please say one of the following: Describe, Recognize, Identify, Where, or Find.', 'english');
      await startCommandRecording();
      return;
    }
    if (keyword === 'stop' || keyword === 'quit') { await endSession(); return; }

    lastKeyword.current = keyword;

    if (!languageAsked.current) {
      languageAsked.current = true;
      await askLanguagePreference();
    }

    const success = await runModule(keyword, transcript);
    if (success) await askFollowUp();
  }

  async function askLanguagePreference() {
    setStatus(STATES.LANGUAGE_SELECT);
    setStatusText('Say "English" or "Arabic"');
    await speak('Do you want the response in English or Arabic?', 'english');
    Vibration.vibrate([0, 300, 150, 300]);
    await DELAY(200);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recordingRef.current = recording;
    await DELAY(2000);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    recordingRef.current = null;
    const audio_b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const sttRes = await fetch(`${API_BASE_URL}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_b64, language_code: 'en' }),
    });
    const sttData = await safeJson(sttRes);
    const t = (sttData?.transcript || '').toLowerCase();
    const chosen = (t.includes('arabic') || t.includes('arab')) ? 'arabic' : 'english';
    languageRef.current = chosen;
    setLanguage(chosen);
    await speak(
      chosen === 'arabic'
        ? 'Great. I will respond in Arabic from now on.'
        : 'Great. I will respond in English from now on.',
      'english'
    );
  }

  async function runModule(keyword, transcript) {
    setStatus(STATES.PROCESSING);

    switch (keyword) {

      case 'describe': {
        Vibration.vibrate(300);
        await DELAY(300);
        setStatusText('📷 Take a scan of the room…');
        await speak('Take a scan of the room.', 'english');
        setStatusText('Scanning…');
        const frames = await captureVideoFrames(1500);
        setStatusText('Analyzing…');
        try {
          const res = await describe(frames, getLang());
          if (res?.audio) await playAudioBase64(res.audio);
          setStatusText(res?.text || 'Done.');
        } catch (e) {
          await speak('Sorry, I could not describe the scene. Please try again.', 'english');
        }
        return true;
      }

      case 'recognize': {
        Vibration.vibrate(300);
        await DELAY(300);
        setStatusText('📷 Take a scan of the room…');
        await speak('Take a scan of the room.', 'english');
        setStatusText('Scanning…');
        const frames = await captureVideoFrames(1500);
        setStatusText('Recognizing…');
        try {
          const res = await recognize(frames, getLang());
          if (res?.audio) await playAudioBase64(res.audio);
          setStatusText(res?.text || 'Done.');
        } catch (e) {
          await speak('Sorry, I could not recognize anyone. Please try again.', 'english');
        }
        return true;
      }

      case 'identify': {
        Vibration.vibrate(300);
        const obj = parseObject(transcript);
        let loc = parseLocation(transcript);
        if (!obj) {
          await speak('Please repeat and specify the item and location. For example: identify my wallet in the kitchen.', 'english');
          await startCommandRecording();
          return false;
        }
        if (!loc) {
          await speak('Where is your ' + obj + '? Please say the location.', 'english');
          Vibration.vibrate(500);
          await DELAY(600);
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          recordingRef.current = recording;
          await DELAY(5000);
          await recordingRef.current.stopAndUnloadAsync();
          const uri = recordingRef.current.getURI();
          recordingRef.current = null;
          if (uri) {
            const audio_b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
            const sttRes = await fetch(`${API_BASE_URL}/stt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio_b64, language_code: 'en' }),
            });
            const sttData = await safeJson(sttRes);
            loc = cleanTranscript(sttData?.transcript || '');
          }
        }
        if (!loc) {
          await speak('I did not catch the location. Please try again.', 'english');
          await startCommandRecording();
          return false;
        }
        try {
          const res = await identify(obj, loc, getLang());
          if (res?.audio) await playAudioBase64(res.audio);
          setStatusText(res?.text || 'Done.');
        } catch (e) {
          await speak('Sorry, I could not register that item. Please try again.', 'english');
        }
        return true;
      }

      case 'where': {
        Vibration.vibrate(300);
        const obj = parseObject(transcript);
        if (!obj) {
          await speak('Please specify the item. For example: where is my wallet.', 'english');
          await startCommandRecording();
          return false;
        }
        try {
          const res = await whereIsItem(obj, getLang());
          if (!res || !res.audio) {
            await speak(`I could not find your ${obj}. Please register it first using the identify command.`, 'english');
          } else {
            await playAudioBase64(res.audio);
            setStatusText(res?.text || 'Done.');
          }
        } catch (e) {
          await speak(`I could not find your ${obj}. Please register it first using the identify command.`, 'english');
        }
        return true;
      }

      case 'find': {
        Vibration.vibrate(300);
        const obj = parseObject(transcript) || transcript;
        if (!obj) {
          await speak('Please tell me what to find. For example: find my wallet.', 'english');
          await startCommandRecording();
          return false;
        }

        // check registration before scanning
        setStatusText(`Checking if ${obj} is registered…`);
        try {
          const regRes = await checkRegistered(obj);
          if (!regRes?.registered) {
            await speak(`Your ${obj} is not registered. Please register it first using the identify command.`, 'english');
            return true;
          }
        } catch (e) {
          await speak('Sorry, something went wrong. Please try again.', 'english');
          return true;
        }

        // reset excluded boxes for fresh find session
        excludedBoxesRef.current = [];
        currentItemRef.current   = obj;

        const MAX_SCANS = 3;
        for (let attempt = 1; attempt <= MAX_SCANS; attempt++) {
          if (attempt === 1) {
            await DELAY(300);
            setStatusText('📷 Scan the room slowly from left to right…');
            await speak('Scan the room slowly from left to right.', 'english');
          } else {
            setStatusText(`📷 Scan attempt ${attempt} of ${MAX_SCANS}. Move the camera slowly…`);
            await speak(`Scan ${attempt} of ${MAX_SCANS}. Move the camera slowly from left to right.`, 'english');
          }

          await DELAY(3000);
          setStatusText('Scanning…');
          const frames = await captureVideoFrames(1500);
          setStatusText(`Looking for your ${obj}…`);

          try {
            const scan = await findScan(obj, frames, getLang(), excludedBoxesRef.current);
            console.log('Find scan result:', scan?.status, scan?.message || '');
            if (scan?.audio) await playAudioBase64(scan.audio);

            if (scan?.status === 'not_registered') {
              return true;
            }

            if (scan?.status === 'no_sticker') {
              return true;
            }

            if (scan?.status === 'found') {
              startWalkMode(obj, scan);
              return false;
            }

            if (attempt === MAX_SCANS) {
              await speak(`I could not find your ${obj} after ${MAX_SCANS} scans. It may have been moved or is out of view.`, 'english');
              return true;
            }

            await DELAY(2000);

          } catch (e) {
            await speak('Sorry, something went wrong. Please try again.', 'english');
            return true;
          }
        }
        return true;
      }

      default:
        await speak('Command not understood. Please try again.', 'english');
        return true;
    }
  }

  async function askFollowUp() {
    setStatus(STATES.FOLLOWUP);
    setStatusText('Done.');
    await DELAY(500);
    if (!sessionActive.current) return;
    waitingFollowup.current = true;
    await speak('Is there anything else I can help you with? Say a command or stop to exit.', 'english');
    Vibration.vibrate([0, 300, 150, 300]);
    await DELAY(200);
    await startCommandRecording();
  }

  async function endSession() {
    sessionActive.current   = false;
    waitingFollowup.current = false;
    clearInterval(walkTimerRef.current);
    clearInterval(obstacleTimerRef.current);
    wsRef.current?.close();
    await speak('Goodbye. Say Hey Suji whenever you need me.', 'english');
    await resumeWakeLoop();
  }

  async function resumeWakeLoop() {
    sessionActive.current   = false;
    waitingFollowup.current = false;
    await startWakeLoop();
  }

  async function handleMicPress() {
    if (status === STATES.PROCESSING || status === STATES.RESPONDING) return;
    if (status === STATES.LISTENING) { await finishListening(); return; }
    stopWakeLoop();
    sessionActive.current = true;
    Vibration.vibrate([0, 150, 80, 150]);
    await startCommandRecording();
  }

  async function captureFrames(count = 1) {
    const ref = cameraRef.current;
    if (!ref) return [];
    if (!cameraReady) await DELAY(1000);
    const frames = [];
    for (let i = 0; i < count; i++) {
      try {
        const photo = await ref.takePictureAsync({ base64: true, quality: 0.6, skipProcessing: true });
        if (photo?.base64) frames.push(photo.base64);
      } catch (e) {}
    }
    return frames;
  }

  async function captureVideoFrames(duration = 5000) {
    const ref = cameraRef.current;
    if (!ref) return [];
    if (!cameraReady) await DELAY(1000);
    const frames = [];
    const steps  = Math.floor(duration / 500);
    for (let i = 0; i < steps; i++) {
      try {
        const photo = await ref.takePictureAsync({ base64: true, quality: 0.5, skipProcessing: true });
        if (photo?.base64) frames.push(photo.base64);
      } catch (e) {}
      await DELAY(500);
    }
    console.log('Video frames captured:', frames.length);
    return frames;
  }

  // ── rescan for next candidate after sticker fails ─────────────────────────
  async function rescanForNextCandidate(ws, itemName, userId) {
    clearInterval(walkTimerRef.current);
    clearInterval(obstacleTimerRef.current);
    walkTimerRef.current     = null;
    obstacleTimerRef.current = null;
    audioQueue.current       = [];

    setStatusText('Scanning for next item…');
    await speak('Let me look for another one. Please scan the room.', 'english');

    await DELAY(2000);
    setStatusText('Scanning…');
    const frames = await captureVideoFrames(2500);

    try {
      const scan = await findScan(itemName, frames, getLang(), excludedBoxesRef.current);
      if (scan?.audio) await playAudioBase64(scan.audio);

      if (scan?.status === 'found') {
        // resume walk with new target
        const newTarget = scan.matches?.[0]?.box_xyxy || null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            action:         'update_target',
            target_box:     newTarget,
            excluded_boxes: excludedBoxesRef.current,
          }));
        }
        // restart walk and obstacle timers
        walkTimerRef.current = setInterval(async () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (isSpeaking.current) return;
          const frame = (await captureFrames(1))[0];
          if (frame) ws.send(JSON.stringify({ action: 'frame', frame }));
        }, 1500);

        obstacleTimerRef.current = setInterval(async () => {
          if (ws.readyState !== WebSocket.OPEN) { clearInterval(obstacleTimerRef.current); return; }
          const frame = (await captureFrames(1))[0];
          if (frame) ws.send(JSON.stringify({ action: 'obstacle_frame', frame }));
        }, 800);

      } else {
        // no more candidates found
        ws.close();
        await speak(`I could not find any more ${itemName}s in the room.`, 'english');
        await askFollowUp();
      }
    } catch (e) {
      ws.close();
      await speak('Sorry, something went wrong.', 'english');
      await askFollowUp();
    }
  }

  function startWalkMode(itemName, scanResult) {
    setStatus(STATES.WALK);
    setWalkInfo('Starting navigation…');

    audioQueue.current      = [];
    isSpeaking.current      = false;
    processingQueue.current = false;

    openFindWalkWS().then(({ ws, user_id }) => {
      wsRef.current      = ws;
      walkWsRef.current  = ws;
      walkUserIdRef.current = user_id;

      ws.onopen = () => ws.send(JSON.stringify({
        item_name:      itemName,
        target_box:     scanResult.matches?.[0]?.box_xyxy || null,
        excluded_boxes: excludedBoxesRef.current,
        language:       getLang(),
        user_id:        user_id,
      }));

      ws.onmessage = async (e) => {
        const data = JSON.parse(e.data);
        console.log('WS message:', data.status, data.message || '');

        if (data.status === 'collecting' || data.status === 'unchanged') return;

        if (data.message) setWalkInfo(data.message);

        if (data.status === 'obstacle') {
          audioQueue.current = audioQueue.current.filter(i => i.label === 'obstacle');
          if (data.audio) enqueueAudio(data.audio, 'obstacle');

        } else if (data.status === 'reached') {
          clearInterval(walkTimerRef.current);
          clearInterval(obstacleTimerRef.current);
          walkTimerRef.current     = null;
          obstacleTimerRef.current = null;
          audioQueue.current = [];
          isSpeaking.current = false;

          if (data.audio) {
            await playAudioBase64(data.audio);
            await DELAY(300);
          }
          Vibration.vibrate([0, 200, 100, 200]);

          // FIX: sticker interval with hard cap of 5 frames
          let stickerFrameCount = 0;
          walkTimerRef.current = setInterval(async () => {
            if (stickerFrameCount >= 5) {
              clearInterval(walkTimerRef.current);
              walkTimerRef.current = null;
              return;
            }
            stickerFrameCount++;
            const frame = (await captureFrames(1))[0];
            if (frame && ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ action: 'sticker_frame', frame }));
          }, 500);

        } else if (data.status === 'confirmed') {
          clearInterval(walkTimerRef.current);
          clearInterval(obstacleTimerRef.current);
          ws.close();
          audioQueue.current = [];
          if (data.audio) await playAudioBase64(data.audio);
          Vibration.vibrate([0,300,100,300,100,300]);
          setStatusText('✅ Item confirmed!');
          await askFollowUp();

        } else if (data.status === 'try_next') {
          // sticker failed — add current box to excluded and rescan
          clearInterval(walkTimerRef.current);
          walkTimerRef.current = null;
          if (data.audio) await playAudioBase64(data.audio);
          if (data.failed_box) {
            excludedBoxesRef.current = [...excludedBoxesRef.current, data.failed_box];
          }
          await rescanForNextCandidate(ws, itemName, user_id);

        } else if (data.status === 'not_confirmed') {
          clearInterval(walkTimerRef.current);
          clearInterval(obstacleTimerRef.current);
          ws.close();
          audioQueue.current = [];
          if (data.audio) await playAudioBase64(data.audio);
          setStatusText(data.message || 'Could not confirm item.');
          await askFollowUp();

        } else if (data.audio) {
          enqueueAudio(data.audio, 'walk');
        }
      };

      ws.onerror = () => {
        clearInterval(walkTimerRef.current);
        clearInterval(obstacleTimerRef.current);
        audioQueue.current = [];
        resumeWakeLoop();
      };

      walkTimerRef.current = setInterval(async () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (isSpeaking.current) return;
        const frame = (await captureFrames(1))[0];
        if (frame) ws.send(JSON.stringify({ action: 'frame', frame }));
      }, 1500);

      obstacleTimerRef.current = setInterval(async () => {
        if (ws.readyState !== WebSocket.OPEN) { clearInterval(obstacleTimerRef.current); return; }
        const frame = (await captureFrames(1))[0];
        if (frame) ws.send(JSON.stringify({ action: 'obstacle_frame', frame }));
      }, 800);
    });
  }

  const btnConfig = {
    [STATES.WAKE_LISTENING]:  { color: '#1e1040', icon: '👂', label: 'Say "Hey Suji" or tap' },
    [STATES.LANGUAGE_SELECT]: { color: '#7c3aed', icon: '🌐', label: 'Say English or Arabic' },
    [STATES.LISTENING]:       { color: '#dc2626', icon: '⏹️', label: 'Listening… tap to stop' },
    [STATES.PROCESSING]:      { color: '#374151', icon: '⏳', label: 'Processing…' },
    [STATES.RESPONDING]:      { color: '#059669', icon: '🔊', label: 'Speaking…' },
    [STATES.FOLLOWUP]:        { color: '#0891b2', icon: '🎙️', label: 'Tap to speak again' },
    [STATES.WALK]:            { color: '#d97706', icon: '🔍', label: 'Navigating…' },
  };
  const btn = btnConfig[status] || btnConfig[STATES.WAKE_LISTENING];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" hidden />
      {camPermission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" ref={cameraRef}
          onCameraReady={() => setCameraReady(true)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
          <TouchableOpacity onPress={reqCamPerm}>
            <Text style={styles.noCameraText}>Tap to grant camera permission</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.overlay} pointerEvents="none" />
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBtn} onPress={() => { cleanup(); navigation.navigate('Setup', { language: getLang() }); }}>
          <Text style={styles.topBtnText}>⚙️ Setup</Text>
        </TouchableOpacity>
        <Text style={styles.langLabel}>{language ? (language === 'arabic' ? 'AR' : 'EN') : '?'}</Text>
      </View>
      {statusText ? (
        <View style={styles.statusBubble}>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      ) : null}
      <View style={styles.focusBox} pointerEvents="none" />
      {status === STATES.WALK && walkInfo ? (
        <View style={styles.walkBadge}><Text style={styles.walkText}>🔍 {walkInfo}</Text></View>
      ) : null}
      <View style={styles.bottomBar}>
        <Text style={styles.btnLabel}>{btn.label}</Text>
        <TouchableOpacity
          style={[styles.micBtn, { backgroundColor: btn.color },
            status === STATES.LISTENING && styles.micBtnListening]}
          onPress={handleMicPress}
          disabled={status === STATES.PROCESSING || status === STATES.RESPONDING}
        >
          <Text style={styles.micIcon}>{btn.icon}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  noCamera: { backgroundColor: '#0a0a14', alignItems: 'center', justifyContent: 'center' },
  noCameraText: { color: 'rgba(200,160,255,0.7)', fontSize: 15 },
  topBar: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, zIndex: 10 },
  topBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  topBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  langLabel: { color: '#fff', fontWeight: '700', fontSize: 13 },
  statusBubble: { position: 'absolute', top: 110, left: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 12, zIndex: 8 },
  statusText: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  focusBox: { position: 'absolute', top: '50%', left: '50%', width: 120, height: 120, marginTop: -60, marginLeft: -60, borderWidth: 1.5, borderColor: 'rgba(251,191,36,0.7)', borderRadius: 4 },
  walkBadge: { position: 'absolute', bottom: 180, alignSelf: 'center', backgroundColor: 'rgba(217,119,6,0.2)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  walkText: { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 50, left: 0, right: 0, alignItems: 'center', gap: 12 },
  btnLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  micBtn: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 10 },
  micBtnListening: { borderColor: '#ff4757', shadowColor: '#ff4757', shadowOpacity: 0.9, elevation: 15 },
  micIcon: { fontSize: 44 },
});