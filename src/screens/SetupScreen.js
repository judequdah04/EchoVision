import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Modal, Alert, StatusBar, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerFace, stickerSetup, getStickerProfile, textToSpeech, playAudioBase64 } from '../api';
import { API_BASE_URL } from '../config';

const COLORS = ['red','blue','green','yellow','orange','purple','pink'];
const COLOR_HEX = {
  red:'#ef4444', blue:'#3b82f6', green:'#22c55e',
  yellow:'#eab308', orange:'#f97316', purple:'#a855f7', pink:'#ec4899',
};
const SHAPES = ['circle','square','rectangle','triangle'];

const INSTRUCTIONS = {
  english: `Welcome to EchoVision. I am Suji, your AI vision assistant. Here is how to use me.

Important: Please make sure your phone is not on silent mode so you can hear my responses.

First, you can add people by going to the Add People button. Point the camera at a person and enter their name, then tap Capture and Register. You can add multiple people.

Second, set up your sticker by going to the Sticker Shape and Color button. Choose a color and shape for your personal sticker that you will attach to your belongings.

Here are your voice commands. Say Describe to hear a description of your surroundings. Say Recognize to identify people in front of you and their emotions. Say Identify my, followed by the item name and location, to save a personal item. For example: Identify my water bottle in the kitchen. Say Where is my, followed by the item name, to find where you last saved it. Say Find my, followed by the item name, to locate it in real time using your sticker.

To activate me, say Hey Suji at any time. You can also tap the microphone button on the camera screen to start recording your command. When the phone vibrates once, it means I am ready to listen to your command. Tap the button again to stop recording early.`,

  arabic: `مرحباً بك في EchoVision. أنا سوجي، مساعدك الذكي للرؤية. إليك كيفية استخدامي.

مهم: تأكد من أن هاتفك ليس على وضع الصامت حتى تتمكن من سماع ردودي.

أولاً، يمكنك إضافة أشخاص عبر زر Add People. وجّه الكاميرا نحو الشخص وأدخل اسمه، ثم اضغط على Capture and Register. يمكنك إضافة عدة أشخاص.

ثانياً، قم بإعداد ملصقك عبر زر Sticker Shape and Color. اختر لوناً وشكلاً للملصق الشخصي الذي ستضعه على أغراضك.

إليك أوامر الصوت. قل Describe لسماع وصف لمحيطك. قل Recognize للتعرف على الأشخاص أمامك ومشاعرهم. قل Identify my متبوعاً باسم الغرض والمكان لحفظ غرض شخصي. مثال: Identify my water bottle in the kitchen. قل Where is my متبوعاً باسم الغرض لمعرفة آخر مكان حفظته فيه. قل Find my متبوعاً باسم الغرض لتحديد موقعه في الوقت الفعلي.

لتفعيلي، قل Hey Suji في أي وقت. يمكنك أيضاً الضغط على زر الميكروفون في شاشة الكاميرا لبدء تسجيل أمرك. عندما يهتز الهاتف مرة واحدة، فهذا يعني أنني مستعد للاستماع إلى أمرك. اضغط على الزر مرة أخرى لإيقاف التسجيل مبكراً.`
};

export default function SetupScreen({ navigation, route }) {
  const [lang, setLang]                   = useState(route?.params?.language || 'english');
  const [modal, setModal]                 = useState(null);
  const [personName, setPersonName]       = useState('');
  const [stickerColor, setStickerColor]   = useState('red');
  const [stickerShape, setStickerShape]   = useState('circle');
  const [currentSticker, setCurrentSticker] = useState(null); // what's saved in Firebase
  const [cameraRef, setCameraRef]         = useState(null);
  const [capturing, setCapturing]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [loadingSticker, setLoadingSticker] = useState(false);
  const [playingInstructions, setPlayingInstructions] = useState(false);
  const [permission, requestPermission]   = useCameraPermissions();

  // Fetch current sticker profile when component mounts
  useEffect(() => {
    fetchStickerProfile();
  }, []);

  async function fetchStickerProfile() {
    setLoadingSticker(true);
    try {
      const data = await getStickerProfile();
      if (data?.profile) {
        setCurrentSticker(data.profile);
        setStickerColor(data.profile.color || 'red');
        setStickerShape(data.profile.shape || 'circle');
      }
    } catch (e) {
      // no profile yet — defaults stay
    } finally {
      setLoadingSticker(false);
    }
  }

  async function playInstructions() {
    if (playingInstructions) return;
    setPlayingInstructions(true);
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const text = INSTRUCTIONS[lang] || INSTRUCTIONS.english;
      const res  = await textToSpeech(text, lang);
      if (res.audio) {
        await playAudioBase64(res.audio);
      } else {
        Alert.alert('Instructions', text);
      }
    } catch (err) {
      Alert.alert('Instructions', INSTRUCTIONS.english);
    } finally {
      setPlayingInstructions(false);
    }
  }

  async function captureAndRegister() {
    if (!personName.trim()) { Alert.alert('Required', 'Enter a person name first.'); return; }
    if (!cameraRef) return;
    setCapturing(true);
    try {
      const frames = [];
      for (let i = 0; i < 8; i++) {
        const photo = await cameraRef.takePictureAsync({ base64: true, quality: 0.5 });
        frames.push(photo.base64);
        await new Promise(r => setTimeout(r, 300));
      }
      const result = await registerFace(personName.trim(), frames);
      Alert.alert('Success', result.message || 'Face registered!');
      setModal(null);
      setPersonName('');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setCapturing(false);
    }
  }

  async function saveStickerSettings() {
    setSaving(true);
    try {
      await stickerSetup(stickerColor, stickerShape);
      setCurrentSticker({ color: stickerColor, shape: stickerShape });
      Alert.alert('Saved', `Sticker updated to ${stickerColor} ${stickerShape}`);
      setModal(null);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleBackToSignUp() {
    await AsyncStorage.removeItem('ev_launched');
    navigation.navigate('SignUp');
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      <View style={styles.langRow}>
        {['english','arabic'].map(l => (
          <TouchableOpacity
            key={l}
            onPress={() => setLang(l)}
            style={[styles.langBtn, lang === l && styles.langBtnActive]}
          >
            <Text style={styles.langBtnText}>{l === 'english' ? 'EN' : 'AR'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.appName}>EchoVision</Text>
        <Text style={styles.subtitle}>Hello, I'm <Text style={styles.suji}>Suji.</Text></Text>
        <Text style={styles.hint}>Assistant setup panel</Text>

        {/* Silent mode warning */}
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            🔔 Make sure your phone is <Text style={styles.warningBold}>not on silent mode</Text> to hear Suji's responses.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.startBtn, playingInstructions && { opacity: 0.7 }]}
          onPress={playInstructions}
          disabled={playingInstructions}
        >
          {playingInstructions ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator color="#fff" />
              <Text style={[styles.startBtnText, { marginLeft: 10 }]}>Playing…</Text>
            </View>
          ) : (
            <Text style={styles.startBtnText}>▶  START — Play Instructions</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.addPeopleBtn} onPress={() => {
          if (!permission?.granted) requestPermission();
          setModal('people');
        }}>
          <Text style={styles.btnText}>👤  Add People</Text>
        </TouchableOpacity>

        {/* Sticker button — shows current sticker if set */}
        <TouchableOpacity
          style={styles.stickerBtn}
          onPress={() => setModal('sticker')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.btnText}>🏷️  Sticker Shape and Color</Text>
            {loadingSticker ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : currentSticker ? (
              <View style={styles.stickerBadge}>
                <View style={[styles.stickerDot, { backgroundColor: COLOR_HEX[currentSticker.color] || '#fff' }]} />
                <Text style={styles.stickerBadgeText}>
                  {currentSticker.color} {currentSticker.shape}
                </Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>

        <Text style={styles.handoffHint}>
          When setup is complete, tap below to hand phone to user
        </Text>

        <TouchableOpacity
          style={styles.goBtn}
          onPress={() => navigation.navigate('Camera', { language: lang })}
        >
          <Text style={styles.goBtnText}>→  Start EchoVision</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={handleBackToSignUp}>
          <Text style={styles.backBtnText}>← Back to Sign Up</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Modal: Add People */}
      <Modal visible={modal === 'people'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>👤 Add People</Text>
              <TouchableOpacity onPress={() => setModal(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Person's name"
              placeholderTextColor="rgba(210,160,255,0.4)"
              value={personName}
              onChangeText={setPersonName}
            />
            {permission?.granted ? (
              <CameraView style={styles.cameraPreview} facing="back" ref={ref => setCameraRef(ref)} />
            ) : (
              <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
                <Text style={styles.permBtnText}>Grant Camera Permission</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.captureBtn, capturing && { opacity: 0.6 }]}
              onPress={captureAndRegister}
              disabled={capturing}
            >
              <Text style={styles.captureBtnText}>
                {capturing ? 'Capturing…' : '📸 Capture & Register'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Sticker */}
      <Modal visible={modal === 'sticker'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🏷️ Sticker Setup</Text>
              <TouchableOpacity onPress={() => setModal(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Show current sticker if one exists */}
            {currentSticker && (
              <View style={styles.currentStickerRow}>
                <Text style={styles.currentStickerLabel}>Current sticker: </Text>
                <View style={[styles.stickerDot, { backgroundColor: COLOR_HEX[currentSticker.color] || '#fff' }]} />
                <Text style={styles.currentStickerValue}>
                  {currentSticker.color} {currentSticker.shape}
                </Text>
              </View>
            )}

            <Text style={styles.sectionLabel}>COLOR</Text>
            <View style={styles.colorRow}>
              {COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setStickerColor(c)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: COLOR_HEX[c] },
                    stickerColor === c && styles.colorDotSelected,
                  ]}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>SHAPE</Text>
            <View style={styles.shapeRow}>
              {SHAPES.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStickerShape(s)}
                  style={[styles.shapeBtn, stickerShape === s && styles.shapeBtnActive]}
                >
                  <Text style={styles.shapeBtnText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={saveStickerSettings}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? 'Saving…' : currentSticker ? '💾 Update Sticker' : '💾 Save Sticker'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0020' },
  langRow: {
    position: 'absolute', top: 52, right: 16, zIndex: 10,
    flexDirection: 'row', gap: 6,
  },
  langBtn: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  langBtnActive: { backgroundColor: 'rgba(124,58,237,0.5)' },
  langBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  content: {
    alignItems: 'center', paddingTop: 100, paddingBottom: 40, paddingHorizontal: 24, gap: 16,
  },
  appName: {
    color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 1,
    textShadowColor: 'rgba(200,100,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  subtitle: { color: 'rgba(220,200,255,0.9)', fontSize: 16, fontWeight: '500' },
  suji: { fontStyle: 'italic', fontWeight: '700', color: '#fff' },
  hint: { color: 'rgba(200,160,255,0.5)', fontSize: 12, textAlign: 'center' },
  warningBox: {
    width: '100%', backgroundColor: 'rgba(234,179,8,0.12)',
    borderWidth: 1, borderColor: 'rgba(234,179,8,0.4)',
    borderRadius: 12, padding: 12,
  },
  warningText: { color: 'rgba(253,224,71,0.9)', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  warningBold: { fontWeight: '800', color: '#fde047' },
  startBtn: {
    width: '100%', paddingVertical: 18, borderRadius: 16,
    backgroundColor: '#e11d7a', alignItems: 'center',
    shadowColor: '#e11d7a', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55, shadowRadius: 16, elevation: 8,
  },
  startBtnText: { color: '#fff', fontWeight: '800', fontSize: 18, letterSpacing: 0.5 },
  addPeopleBtn: {
    width: '100%', paddingVertical: 14, paddingHorizontal: 20,
    borderRadius: 14, backgroundColor: '#0891b2',
    shadowColor: '#06b6d4', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  stickerBtn: {
    width: '100%', paddingVertical: 14, paddingHorizontal: 20,
    borderRadius: 14, backgroundColor: '#4f46e5',
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  stickerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  stickerBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  handoffHint: {
    color: 'rgba(200,160,255,0.6)', fontSize: 12,
    textAlign: 'center', marginTop: 8,
  },
  goBtn: {
    width: '100%', paddingVertical: 16, borderRadius: 14,
    backgroundColor: '#7c3aed', alignItems: 'center',
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  goBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  backBtn: {
    width: '100%', paddingVertical: 12, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  backBtnText: { color: 'rgba(200,160,255,0.8)', fontWeight: '600', fontSize: 14 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#150030',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderWidth: 1, borderColor: 'rgba(180,100,255,0.15)',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 18,
  },
  modalTitle: { color: '#fff', fontWeight: '700', fontSize: 18 },
  modalClose: { color: 'rgba(200,160,255,0.7)', fontSize: 20 },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, color: '#fff', padding: 13,
    fontSize: 14, marginBottom: 14,
  },
  cameraPreview: { width: '100%', height: 160, borderRadius: 14, marginBottom: 14 },
  permBtn: {
    width: '100%', height: 80, borderRadius: 14,
    borderWidth: 2, borderColor: 'rgba(6,182,212,0.4)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  permBtnText: { color: 'rgba(6,182,212,0.8)', fontSize: 14, fontWeight: '600' },
  captureBtn: {
    backgroundColor: '#0891b2', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  captureBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionLabel: {
    color: 'rgba(200,160,255,0.7)', fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, marginBottom: 10,
  },
  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 20 },
  colorDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: 'transparent' },
  colorDotSelected: { borderColor: '#fff' },
  shapeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  shapeBtn: {
    flex: 1, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, alignItems: 'center',
  },
  shapeBtnActive: {
    backgroundColor: 'rgba(124,58,237,0.5)',
    borderColor: 'rgba(124,58,237,0.8)',
  },
  shapeBtnText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  currentStickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10, padding: 10, marginBottom: 16,
  },
  currentStickerLabel: { color: 'rgba(200,160,255,0.7)', fontSize: 12 },
  currentStickerValue: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  stickerDot: { width: 14, height: 14, borderRadius: 7 },
  saveBtn: {
    backgroundColor: '#4f46e5', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});