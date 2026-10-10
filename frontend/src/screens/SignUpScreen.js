import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  StatusBar, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, type, touch } from '../theme';
import EchoVisionLogo from '../components/EchoVisionLogo';

const FS = 2; // maxFontSizeMultiplier for every Text on this screen
 
export default function SignUpScreen({ navigation }) {
  const [mode, setMode]         = useState('signup'); // 'signup' | 'login' | 'forgot'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail]       = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
 
  useEffect(() => {
    AsyncStorage.getItem('ev_launched').then((val) => {
      if (val) navigation.replace('Setup');
    });
  }, []);
 
  // ── Sign Up ───────────────────────────────────────────────────────────────
  async function handleSignUp() {
    if (!username.trim()) {
      Alert.alert('Required', 'Please enter a username.');
      return;
    }
    if (!password.trim() || password.length < 6) {
      Alert.alert('Required', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      // Check if account already exists
      const existing = await AsyncStorage.getItem(`ev_user_${username.trim().toLowerCase()}`);
      if (existing) {
        Alert.alert(
          'Account Exists',
          'An account with this username already exists. Please log in instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log In', onPress: () => { setMode('login'); setPassword(''); } },
          ]
        );
        setLoading(false);
        return;
      }
      // Save new account
      const userData = JSON.stringify({ username: username.trim(), password });
      await AsyncStorage.setItem(`ev_user_${username.trim().toLowerCase()}`, userData);
      await AsyncStorage.setItem('ev_username', username.trim());
      await AsyncStorage.setItem('ev_launched', '1');
      navigation.replace('Setup');
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }
 
  // ── Log In ────────────────────────────────────────────────────────────────
  async function handleLogin() {
    if (!username.trim()) {
      Alert.alert('Required', 'Please enter your username.');
      return;
    }
    if (!password.trim()) {
      Alert.alert('Required', 'Please enter your password.');
      return;
    }
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem(`ev_user_${username.trim().toLowerCase()}`);
      if (!stored) {
        Alert.alert(
          'Account Not Found',
          'No account found with this username. Would you like to sign up?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Up', onPress: () => { setMode('signup'); setPassword(''); } },
          ]
        );
        setLoading(false);
        return;
      }
      const userData = JSON.parse(stored);
      if (userData.password !== password) {
        Alert.alert('Incorrect Password', 'The password you entered is incorrect. Please try again.');
        setLoading(false);
        return;
      }
      await AsyncStorage.setItem('ev_username', username.trim());
      await AsyncStorage.setItem('ev_launched', '1');
      navigation.replace('Setup');
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }
 
  // ── Forgot Password ───────────────────────────────────────────────────────
  async function handleForgotPassword() {
    if (!username.trim()) {
      Alert.alert('Required', 'Please enter your username to reset your password.');
      return;
    }
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem(`ev_user_${username.trim().toLowerCase()}`);
      if (!stored) {
        Alert.alert('Account Not Found', 'No account found with this username.');
        setLoading(false);
        return;
      }
      // In a real app this would send an email — for demo we show the password
      const userData = JSON.parse(stored);
      Alert.alert(
        'Password Reset',
        `A reset link has been sent to your registered email.\n\nFor demo purposes, your password is: ${userData.password}`,
        [{ text: 'Back to Login', onPress: () => setMode('login') }]
      );
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }
 
  // ── UI ────────────────────────────────────────────────────────────────────
  const isSignUp  = mode === 'signup';
  const isLogin   = mode === 'login';
  const isForgot  = mode === 'forgot';
 
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo (mark + wordmark + tagline), centered */}
        <EchoVisionLogo markWidth={140} />

        {/* Form heading */}
        <Text style={styles.formTitle} maxFontSizeMultiplier={FS} accessibilityRole="header">
          {isSignUp ? 'Sign up' : isLogin ? 'Log in' : 'Forgot password'}
        </Text>

        {/* Username */}
        <Text style={styles.fieldLabel} maxFontSizeMultiplier={FS} importantForAccessibility="no">Username</Text>
        <View style={styles.field}>
          <MaterialCommunityIcons name="account" size={20} color={colors.textSecondary}
            accessible={false} importantForAccessibility="no" />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={colors.textSecondary}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            maxFontSizeMultiplier={FS}
            accessibilityLabel="Username"
          />
        </View>

        {/* Password (hidden on forgot) */}
        {!isForgot && (
          <>
            <Text style={styles.fieldLabel} maxFontSizeMultiplier={FS} importantForAccessibility="no">Password</Text>
            <View style={styles.field}>
              <MaterialCommunityIcons name="lock" size={20} color={colors.textSecondary}
                accessible={false} importantForAccessibility="no" />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Password"
                placeholderTextColor={colors.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                maxFontSizeMultiplier={FS}
                accessibilityLabel="Password"
                accessibilityHint={isSignUp ? 'At least 6 characters.' : undefined}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPass(!showPass)}
                accessibilityRole="button"
                accessibilityLabel={showPass ? 'Hide password' : 'Show password'}
              >
                <MaterialCommunityIcons name={showPass ? 'eye-off' : 'eye'} size={22} color={colors.textSecondary}
                  accessible={false} importantForAccessibility="no" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Forgot password link (only on login) */}
        {isLogin && (
          <TouchableOpacity
            onPress={() => { setMode('forgot'); setPassword(''); }}
            style={styles.forgotRow}
            accessibilityRole="button"
            accessibilityLabel="Forgot password?"
            accessibilityHint="Opens password reset."
          >
            <Text style={styles.linkText} maxFontSizeMultiplier={FS}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        {/* Main button */}
        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.btnBusy]}
          onPress={isSignUp ? handleSignUp : isLogin ? handleLogin : handleForgotPassword}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={isSignUp ? 'Sign up' : isLogin ? 'Log in' : 'Reset password'}
          accessibilityHint={isSignUp
            ? 'Creates your account and opens setup.'
            : isLogin ? 'Logs in and opens setup.' : 'Shows how to reset your password.'}
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? <ActivityIndicator color={colors.onAccent} /> : null}
          <Text style={styles.primaryBtnText} maxFontSizeMultiplier={FS}>
            {loading ? 'Please wait…' : isSignUp ? 'Sign up' : isLogin ? 'Log in' : 'Reset password'}
          </Text>
        </TouchableOpacity>

        {/* Switch mode */}
        {isSignUp && (
          <View style={styles.switchRow}>
            <Text style={styles.switchText} maxFontSizeMultiplier={FS}>Already have an account?</Text>
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => { setMode('login'); setPassword(''); }}
              accessibilityRole="button"
              accessibilityLabel="Log in"
              accessibilityHint="Switches to the log in form."
            >
              <Text style={styles.linkText} maxFontSizeMultiplier={FS}>Log in</Text>
            </TouchableOpacity>
          </View>
        )}

        {(isLogin || isForgot) && (
          <View style={styles.switchRow}>
            <Text style={styles.switchText} maxFontSizeMultiplier={FS}>Don't have an account?</Text>
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => { setMode('signup'); setPassword(''); }}
              accessibilityRole="button"
              accessibilityLabel="Sign up"
              accessibilityHint="Switches to the sign up form."
            >
              <Text style={styles.linkText} maxFontSizeMultiplier={FS}>Sign up</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // The one horizontal gutter for the screen
  content: {
    flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: spacing.gutter, paddingVertical: spacing.xl,
  },

  // Form heading: 32pt below the logo
  formTitle: { ...type.heading, color: colors.textPrimary, marginTop: spacing.xxl, marginBottom: spacing.lg },

  // Fields
  fieldLabel: { ...type.rowSecondary, color: colors.textSecondary, marginBottom: spacing.sm },
  field: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.notice,
    paddingLeft: spacing.lg, marginBottom: spacing.lg,
  },
  input: {
    flex: 1, minHeight: 56, color: colors.textPrimary,
    ...type.rowLabel, fontWeight: '400', paddingRight: spacing.lg,
  },
  eyeBtn: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs },

  forgotRow: { alignSelf: 'flex-end', minHeight: touch.min, justifyContent: 'center', marginTop: -spacing.sm },

  // Primary action
  primaryBtn: {
    height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.group, marginTop: spacing.sm,
  },
  primaryBtnText: { ...type.button, color: colors.onAccent },
  btnBusy: { opacity: 0.7 },

  // Switch mode
  switchRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, marginTop: spacing.lg,
  },
  switchText: { ...type.rowSecondary, color: colors.textSecondary },
  switchBtn: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.xs },
  linkText: { ...type.link, fontWeight: '600', color: colors.accent },
});
