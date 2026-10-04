import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  StatusBar, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
 
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />
 
      <View style={styles.logoArea}>
        <Text style={styles.appName}>EchoVision</Text>
        <Text style={styles.tagline}>Your AI Vision Assistant</Text>
      </View>
 
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {isSignUp ? 'Sign Up' : isLogin ? 'Log In' : 'Forgot Password'}
        </Text>
 
        {/* Username */}
        <View style={styles.inputRow}>
          <Text style={styles.inputIcon}>👤</Text>
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="rgba(210,160,255,0.4)"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        </View>
 
        {/* Password (hidden on forgot) */}
        {!isForgot && (
          <View style={styles.inputRow}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Password"
              placeholderTextColor="rgba(210,160,255,0.4)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
            />
            <TouchableOpacity onPress={() => setShowPass(!showPass)}>
              <Text style={styles.showBtn}>{showPass ? 'HIDE' : 'SHOW'}</Text>
            </TouchableOpacity>
          </View>
        )}
 
        {/* Forgot password link (only on login) */}
        {isLogin && (
          <TouchableOpacity onPress={() => { setMode('forgot'); setPassword(''); }} style={styles.forgotRow}>
            <Text style={styles.forgotLink}>Forgot password?</Text>
          </TouchableOpacity>
        )}
 
        {/* Main button */}
        <TouchableOpacity
          style={[styles.signUpBtn, loading && { opacity: 0.6 }]}
          onPress={isSignUp ? handleSignUp : isLogin ? handleLogin : handleForgotPassword}
          disabled={loading}
        >
          <Text style={styles.signUpBtnText}>
            {loading ? '...' : isSignUp ? 'Sign Up' : isLogin ? 'Log In' : 'Reset Password'}
          </Text>
        </TouchableOpacity>
 
        {/* Switch mode */}
        {isSignUp && (
          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => { setMode('login'); setPassword(''); }}>
              <Text style={styles.loginLink}>Log In</Text>
            </TouchableOpacity>
          </View>
        )}
 
        {(isLogin || isForgot) && (
          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => { setMode('signup'); setPassword(''); }}>
              <Text style={styles.loginLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
 
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d0020',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 28,
  },
  appName: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 1,
    textShadowColor: 'rgba(200,100,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  tagline: {
    color: 'rgba(210,160,255,0.85)',
    fontSize: 14,
    marginTop: 6,
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: 24,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  inputIcon: { fontSize: 16, marginRight: 8 },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 13,
  },
  showBtn: {
    color: 'rgba(200,160,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
  },
  forgotRow: { alignItems: 'flex-end', marginTop: -6, marginBottom: 14 },
  forgotLink: { color: 'rgba(180,130,255,0.8)', fontSize: 12, fontWeight: '600' },
  signUpBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  signUpBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  loginRow: { flexDirection: 'row', justifyContent: 'center' },
  loginText: { color: 'rgba(200,160,255,0.5)', fontSize: 12 },
  loginLink: { color: 'rgba(180,130,255,0.9)', fontSize: 12, fontWeight: '700' },
});