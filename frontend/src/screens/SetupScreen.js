import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Modal, Alert, StatusBar, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from '../audioCompat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerFace, stickerSetup, getStickerProfile, textToSpeech, playAudioBase64 } from '../api';
import { API_BASE_URL } from '../config';
import { colors, spacing, radius, type, touch } from '../theme';

const FS = 2; // maxFontSizeMultiplier for every Text on this screen

const SHAPE_ICON = {
  circle: 'circle-outline', square: 'square-outline',
  rectangle: 'rectangle-outline', triangle: 'triangle-outline',
};

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

Here are your voice commands.

Say Describe, and I will scan the room and tell you what is around you. I will name the objects I see, tell you whether they are near or far, which direction they are in, and how they relate to each other. I will also warn you about anything that could be in your way.

Say Recognize, and I will tell you who is in front of you. If I know the person, I will say their name, how close they are, and how they seem to be feeling. If I do not know them, I will tell you that too.

Say Identify my, followed by the item name and the room, to save where you left a personal item. I will remember the item, the room, and the time.

Say Where is my, followed by the item name, and I will tell you where and when you last saved it. This works instantly and does not need the camera.

Say Find my, followed by the item name, and I will help you reach it. First I will ask you to slowly scan the room, then I will guide you step by step with directions, and I will warn you about obstacles on the way. When you are close, I will ask you to hold the item up to the camera, and I will check its sticker to confirm that it is yours.

To activate me, say Hey Suji at any time. You can also tap the microphone button on the camera screen to start recording your command. When the phone vibrates once, it means I am ready to listen to your command. Tap the button again to stop recording early.`,

  arabic: `مرحباً بك في EchoVision. أنا سوجي، مساعدك الذكي للرؤية. إليك كيفية استخدامي.

مهم: تأكد من أن هاتفك ليس على وضع الصامت حتى تتمكن من سماع ردودي.

أولاً، يمكنك إضافة أشخاص عبر زر Add People. وجّه الكاميرا نحو الشخص وأدخل اسمه، ثم اضغط على Capture and Register. يمكنك إضافة عدة أشخاص.

ثانياً، قم بإعداد ملصقك عبر زر Sticker Shape and Color. اختر لوناً وشكلاً للملصق الشخصي الذي ستضعه على أغراضك.

إليك أوامر الصوت.

قل Describe، وسأفحص الغرفة وأخبرك بما يحيط بك. سأذكر الأشياء التي أراها، وهل هي قريبة أم بعيدة، وفي أي اتجاه تقع، وكيف ترتبط ببعضها. وسأحذرك أيضاً من أي شيء قد يعترض طريقك.

قل Recognize، وسأخبرك من يقف أمامك. إذا كنت أعرف الشخص، فسأذكر اسمه، ومدى قربه منك، وكيف يبدو شعوره. وإذا لم أكن أعرفه، فسأخبرك بذلك أيضاً.

قل Identify my متبوعاً باسم الغرض والغرفة، لحفظ المكان الذي تركت فيه غرضاً شخصياً. سأتذكر الغرض والغرفة والوقت.

قل Where is my متبوعاً باسم الغرض، وسأخبرك أين ومتى حفظته آخر مرة. يعمل هذا الأمر فوراً ولا يحتاج إلى الكاميرا.

قل Find my متبوعاً باسم الغرض، وسأساعدك على الوصول إليه. سأطلب منك أولاً أن تمسح الغرفة ببطء، ثم سأرشدك خطوة بخطوة بالاتجاهات، وسأحذرك من العوائق في الطريق. وعندما تقترب، سأطلب منك أن ترفع الغرض أمام الكاميرا، وسأتحقق من ملصقه للتأكد من أنه يخصك.

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
      // Split on sentence boundaries (never mid-word), then group sentences into
      // chunks of up to ~300 characters so each TTS request stays short.
      const sentences = text.match(/[^.!?؟\n]+[.!?؟]*/g)?.map(s => s.trim()).filter(Boolean) || [];
      const chunks = [];
      for (const s of sentences) {
        const last = chunks.length - 1;
        if (last >= 0 && chunks[last].length + 1 + s.length <= 300) chunks[last] += ' ' + s;
        else chunks.push(s);
      }
      // Speak each chunk in order; awaiting playback keeps them from overlapping.
      for (const chunk of chunks) {
        const res = await textToSpeech(chunk, lang);
        if (!res?.audio) throw new Error('No audio returned for instructions chunk');
        await playAudioBase64(res.audio);
      }
    } catch (e) {
      console.error('instructions TTS error:', e);
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

  // Display only: stack the sticker value under its label at large text sizes.
  const { fontScale } = useWindowDimensions();
  const stackValue = fontScale > 1.3;
  const swatchColor = currentSticker ? (COLOR_HEX[currentSticker.color] || colors.textPrimary) : null;
  const stickerA11y = loadingSticker
    ? 'Item sticker, loading'
    : currentSticker
      ? `Item sticker, ${currentSticker.color} ${currentSticker.shape}`
      : 'Item sticker, not set';

  const stickerValue = loadingSticker ? (
    <Text style={styles.rowSecondary} maxFontSizeMultiplier={FS} numberOfLines={1}>Loading…</Text>
  ) : currentSticker ? (
    <View style={[styles.valuePill, stackValue && styles.valuePillStacked]}>
      <View
        style={currentSticker.shape === 'triangle'
          ? [styles.swatchTriangle, { borderBottomColor: swatchColor }]
          : [styles.swatch, SWATCH_SHAPE[currentSticker.shape], { backgroundColor: swatchColor }]}
      />
      <Text style={styles.valueText} maxFontSizeMultiplier={FS} numberOfLines={1}>
        <Text style={styles.capitalize}>{currentSticker.color}</Text> {currentSticker.shape}
      </Text>
    </View>
  ) : (
    <Text style={styles.rowSecondary} maxFontSizeMultiplier={FS} numberOfLines={1}>Not set</Text>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 1. Top bar: language toggle */}
        <View style={styles.topBar}>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Language">
            {['english','arabic'].map(l => (
              <TouchableOpacity
                key={l}
                onPress={() => setLang(l)}
                style={[styles.segmentBtn, lang === l && styles.segmentBtnActive]}
                hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                accessibilityRole="radio"
                accessibilityLabel={l === 'english' ? 'English' : 'Arabic'}
                accessibilityHint="Sets the language for instructions and Suji's answers."
                accessibilityState={{ selected: lang === l }}
              >
                <Text
                  style={[styles.segmentText, lang === l && styles.segmentTextActive]}
                  maxFontSizeMultiplier={FS}
                >
                  {l === 'english' ? 'EN' : 'AR'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 2. Title + greeting */}
        <Text
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          maxFontSizeMultiplier={FS}
          accessibilityRole="header"
        >
          EchoVision
        </Text>
        <Text style={styles.greeting} maxFontSizeMultiplier={FS}>
          Hello, I'm <Text style={styles.suji}>Suji</Text>.
        </Text>

        {/* 3. Silent-mode notice (not a button) */}
        <View
          style={styles.notice}
          accessible
          accessibilityRole="text"
          accessibilityLabel="Turn off silent mode to hear Suji."
        >
          <MaterialCommunityIcons name="volume-off" size={20} color={colors.warn}
            accessible={false} importantForAccessibility="no" />
          <Text style={styles.noticeText} maxFontSizeMultiplier={FS}>
            Turn off silent mode to hear Suji.
          </Text>
        </View>

        {/* 4. Setup list */}
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={playInstructions}
            disabled={playingInstructions}
            accessibilityRole="button"
            accessibilityLabel={playingInstructions ? 'Play instructions, playing' : 'Play instructions'}
            accessibilityHint="Suji reads out how to use the app."
            accessibilityState={{ disabled: playingInstructions, busy: playingInstructions }}
          >
            <View style={styles.iconTile} accessible={false} importantForAccessibility="no-hide-descendants">
              <MaterialCommunityIcons name={playingInstructions ? 'volume-high' : 'play'} size={22} color={colors.accent} />
            </View>
            <View style={styles.labelCol}>
              <Text style={styles.rowLabel} numberOfLines={2} maxFontSizeMultiplier={FS}>Play instructions</Text>
              {playingInstructions ? (
                <Text style={styles.rowSecondary} maxFontSizeMultiplier={FS}>Playing…</Text>
              ) : null}
            </View>
          </TouchableOpacity>

          <View style={styles.divider} accessible={false} importantForAccessibility="no" />

          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              if (!permission?.granted) requestPermission();
              setModal('people');
            }}
            accessibilityRole="button"
            accessibilityLabel="Add people, faces Suji recognizes"
            accessibilityHint="Opens face registration."
          >
            <View style={styles.iconTile} accessible={false} importantForAccessibility="no-hide-descendants">
              <MaterialCommunityIcons name="account-plus" size={22} color={colors.accent} />
            </View>
            <View style={styles.labelCol}>
              <Text style={styles.rowLabel} numberOfLines={2} maxFontSizeMultiplier={FS}>Add people</Text>
              <Text style={styles.rowSecondary} maxFontSizeMultiplier={FS}>Faces Suji recognizes</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textSecondary}
              accessible={false} importantForAccessibility="no" />
          </TouchableOpacity>

          <View style={styles.divider} accessible={false} importantForAccessibility="no" />

          <TouchableOpacity
            style={styles.row}
            onPress={() => setModal('sticker')}
            accessibilityRole="button"
            accessibilityLabel={stickerA11y}
            accessibilityHint="Opens sticker color and shape."
          >
            <View style={styles.iconTile} accessible={false} importantForAccessibility="no-hide-descendants">
              <MaterialCommunityIcons name="tag" size={22} color={colors.accent} />
            </View>
            <View style={styles.labelCol}>
              <Text style={styles.rowLabel} numberOfLines={2} maxFontSizeMultiplier={FS}>Item sticker</Text>
              {stackValue ? stickerValue : null}
            </View>
            {stackValue ? null : stickerValue}
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textSecondary}
              accessible={false} importantForAccessibility="no" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 5. Bottom actions, pinned */}
      <View style={styles.footer}>
        <Text style={styles.helper} maxFontSizeMultiplier={FS}>
          When setup is done, hand the phone to the user.
        </Text>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Camera', { language: lang })}
          accessibilityRole="button"
          accessibilityLabel="Start EchoVision"
          accessibilityHint="Opens the camera screen. Say Hey Suji or tap the button at the bottom."
        >
          <Text style={styles.primaryBtnText} maxFontSizeMultiplier={FS}>Start EchoVision</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={handleBackToSignUp}
          accessibilityRole="button"
          accessibilityLabel="Back to sign up"
          accessibilityHint="Returns to the sign up screen."
        >
          <Text style={styles.linkText} maxFontSizeMultiplier={FS}>Back to sign up</Text>
        </TouchableOpacity>
      </View>

      {/* Modal: Add People */}
      <Modal visible={modal === 'people'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} maxFontSizeMultiplier={FS} accessibilityRole="header">Add people</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModal(null)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                accessibilityHint="Closes add people without saving."
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.textPrimary}
                  accessible={false} importantForAccessibility="no" />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel} maxFontSizeMultiplier={FS}>Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Person's name"
              placeholderTextColor={colors.textSecondary}
              value={personName}
              onChangeText={setPersonName}
              maxFontSizeMultiplier={FS}
              accessibilityLabel="Person's name"
            />
            {permission?.granted ? (
              <CameraView style={styles.cameraPreview} facing="back" ref={ref => setCameraRef(ref)} />
            ) : (
              <TouchableOpacity
                style={styles.permBtn}
                onPress={requestPermission}
                accessibilityRole="button"
                accessibilityLabel="Allow camera access"
                accessibilityHint="Needed to take photos of the person."
              >
                <Text style={styles.permBtnText} maxFontSizeMultiplier={FS}>Allow camera access</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, capturing && styles.btnBusy]}
              onPress={captureAndRegister}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel={capturing ? 'Capturing' : 'Capture and register'}
              accessibilityHint="Takes several photos and saves this person's face."
              accessibilityState={{ disabled: capturing, busy: capturing }}
            >
              {capturing ? <ActivityIndicator color={colors.onAccent} /> : null}
              <Text style={styles.primaryBtnText} maxFontSizeMultiplier={FS}>
                {capturing ? 'Capturing…' : 'Capture and register'}
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Modal: Sticker */}
      <Modal visible={modal === 'sticker'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} maxFontSizeMultiplier={FS} accessibilityRole="header">Item sticker</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModal(null)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                accessibilityHint="Closes sticker setup without saving."
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.textPrimary}
                  accessible={false} importantForAccessibility="no" />
              </TouchableOpacity>
            </View>

            {/* Show current sticker if one exists */}
            {currentSticker && (
              <View style={styles.currentStickerRow} accessible accessibilityRole="text">
                <Text style={styles.currentStickerLabel} maxFontSizeMultiplier={FS}>Current: </Text>
                <View style={[styles.stickerDot, { backgroundColor: COLOR_HEX[currentSticker.color] || colors.textPrimary }]} />
                <Text style={styles.currentStickerValue} maxFontSizeMultiplier={FS}>
                  {currentSticker.color} {currentSticker.shape}
                </Text>
              </View>
            )}

            <Text style={styles.sectionLabel} maxFontSizeMultiplier={FS}>Color</Text>
            <View style={styles.colorRow} accessibilityRole="radiogroup" accessibilityLabel="Sticker color">
              {COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setStickerColor(c)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: COLOR_HEX[c] },
                    stickerColor === c && styles.colorDotSelected,
                  ]}
                  accessibilityRole="radio"
                  accessibilityLabel={c}
                  accessibilityState={{ selected: stickerColor === c }}
                >
                  {stickerColor === c ? (
                    <View style={styles.checkBadge} accessible={false} importantForAccessibility="no-hide-descendants">
                      <MaterialCommunityIcons name="check" size={18} color={colors.onAccent} />
                    </View>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel} maxFontSizeMultiplier={FS}>Shape</Text>
            <View style={styles.shapeRow} accessibilityRole="radiogroup" accessibilityLabel="Sticker shape">
              {SHAPES.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStickerShape(s)}
                  style={[styles.shapeBtn, stickerShape === s && styles.shapeBtnActive]}
                  accessibilityRole="radio"
                  accessibilityLabel={s}
                  accessibilityState={{ selected: stickerShape === s }}
                >
                  <MaterialCommunityIcons
                    name={SHAPE_ICON[s]}
                    size={22}
                    color={stickerShape === s ? colors.onAccent : colors.textPrimary}
                    accessible={false}
                    importantForAccessibility="no"
                  />
                  <Text
                    style={[styles.shapeBtnText, stickerShape === s && styles.shapeBtnTextActive]}
                    maxFontSizeMultiplier={FS}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.btnBusy]}
              onPress={saveStickerSettings}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={saving ? 'Saving' : currentSticker ? 'Update sticker' : 'Save sticker'}
              accessibilityHint="Saves the chosen color and shape."
              accessibilityState={{ disabled: saving, busy: saving }}
            >
              {saving ? <ActivityIndicator color={colors.onAccent} /> : null}
              <Text style={styles.primaryBtnText} maxFontSizeMultiplier={FS}>
                {saving ? 'Saving…' : currentSticker ? 'Update sticker' : 'Save sticker'}
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const ICON_TILE = 36;

const SWATCH_SHAPE = {
  circle:    { width: 12, height: 12, borderRadius: 6 },
  square:    { width: 12, height: 12, borderRadius: 2 },
  rectangle: { width: 16, height: 10, borderRadius: 2 },
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // The one horizontal gutter for the scrolling content
  content: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xl },

  // 1. Top bar
  topBar: { height: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  segment: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 2,
  },
  segmentBtn: {
    height: 32, minWidth: 48, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
  },
  segmentBtnActive: { backgroundColor: colors.accent },
  segmentText: { ...type.link, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: colors.onAccent },

  // 2. Title + greeting
  title: { ...type.display, color: colors.textPrimary, marginTop: spacing.sm },
  greeting: { ...type.greeting, color: colors.textSecondary, marginTop: spacing.xs },
  suji: { color: colors.accent, fontWeight: '600' },

  // 3. Notice
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.notice,
    borderLeftWidth: 3, borderLeftColor: colors.warn,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  noticeText: { ...type.notice, color: colors.textPrimary, flex: 1 },

  // 4. List group
  group: {
    backgroundColor: colors.surface, borderRadius: radius.group, overflow: 'hidden',
    marginTop: spacing.xl,
  },
  row: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconTile: {
    width: ICON_TILE, height: ICON_TILE, borderRadius: radius.sm,
    backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center',
  },
  labelCol: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { ...type.rowLabel, color: colors.textPrimary },
  rowSecondary: { ...type.rowSecondary, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: spacing.lg + ICON_TILE + spacing.md },

  valuePill: {
    flexShrink: 1, maxWidth: '45%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.background, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  valuePillStacked: { maxWidth: '100%', alignSelf: 'flex-start', marginTop: spacing.xs },
  valueText: { ...type.rowSecondary, color: colors.textPrimary, flexShrink: 1 },
  capitalize: { textTransform: 'capitalize' },
  swatch: { width: 12, height: 12 },
  swatchTriangle: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 12,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },

  // 5. Footer
  footer: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.lg },
  helper: { ...type.rowSecondary, color: colors.textSecondary, marginBottom: spacing.md },
  primaryBtn: {
    height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.group,
  },
  primaryBtnText: { ...type.button, color: colors.onAccent },
  btnBusy: { opacity: 0.7 },
  linkBtn: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  linkText: { ...type.link, color: colors.textSecondary },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg,
  },
  modalTitle: { ...type.heading, color: colors.textPrimary },
  closeBtn: {
    width: touch.min, height: touch.min, borderRadius: touch.min / 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised,
  },
  fieldLabel: { ...type.rowSecondary, color: colors.textSecondary, marginBottom: spacing.sm },
  modalInput: {
    minHeight: 56, backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.divider, borderRadius: radius.notice,
    color: colors.textPrimary, paddingHorizontal: spacing.lg, ...type.rowLabel, fontWeight: '400',
    marginBottom: spacing.lg,
  },
  cameraPreview: { width: '100%', height: 200, borderRadius: radius.notice, overflow: 'hidden', marginBottom: spacing.lg },
  permBtn: {
    width: '100%', minHeight: 96, borderRadius: radius.notice,
    borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  permBtnText: { ...type.button, color: colors.accent },

  // Sticker sheet
  sectionLabel: { ...type.rowSecondary, color: colors.textSecondary, marginBottom: spacing.sm },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xl },
  colorDot: {
    width: touch.min, height: touch.min, borderRadius: touch.min / 2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.surface,
  },
  colorDotSelected: { borderColor: colors.textPrimary },
  checkBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.textPrimary, alignItems: 'center', justifyContent: 'center',
  },
  shapeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  shapeBtn: {
    flexBasis: '46%', flexGrow: 1, minHeight: touch.min,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.background, borderRadius: radius.notice, paddingVertical: spacing.sm,
  },
  shapeBtnActive: { backgroundColor: colors.accent },
  shapeBtnText: { ...type.rowLabel, fontWeight: '500', color: colors.textPrimary, textTransform: 'capitalize' },
  shapeBtnTextActive: { color: colors.onAccent, fontWeight: '600' },
  currentStickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.background, borderRadius: radius.notice,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  currentStickerLabel: { ...type.rowSecondary, color: colors.textSecondary },
  currentStickerValue: { ...type.rowSecondary, fontWeight: '600', color: colors.textPrimary, textTransform: 'capitalize' },
  stickerDot: { width: 14, height: 14, borderRadius: 7 },
});
