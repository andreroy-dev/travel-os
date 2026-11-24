import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Appear } from '@/components/motion';
import { Button, ErrorNote, Field, serif, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn } = useSession();
  const [devAllowed, setDevAllowed] = useState(supabase === null);
  const [showDev, setShowDev] = useState(supabase === null);
  const [appleReady, setAppleReady] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ dev_login: boolean }>('/auth/config')
      .then((config) => setDevAllowed(config.dev_login))
      .catch(() => undefined);
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleReady).catch(() => setAppleReady(false));
  }, []);

  async function run(key: string, action: () => Promise<void>) {
    setError(null);
    setBusy(key);
    try {
      await action();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_REQUEST_CANCELED') return;
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(null);
    }
  }

  const sendCode = () =>
    run('code', async () => {
      if (!supabase) return;
      if (!email.trim()) throw new Error('Enter your email.');
      const { error: failure } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
      if (failure) throw failure;
      setCodeSent(true);
    });

  const verifyCode = () =>
    run('verify', async () => {
      if (!supabase) return;
      const { error: failure } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
      if (failure) throw failure;
    });

  const apple = () =>
    run('apple', async () => {
      if (!supabase) return;
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
      const { error: failure } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
      if (failure) throw failure;
    });

  const google = () =>
    run('google', async () => {
      if (!supabase) return;
      const redirectTo = Linking.createURL('auth-callback');
      const { data, error: failure } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (failure || !data.url) throw failure ?? new Error('Google sign-in is not available.');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') return;
      const authCode = new URL(result.url).searchParams.get('code');
      if (!authCode) throw new Error('Google sign-in was not completed.');
      const { error: exchange } = await supabase.auth.exchangeCodeForSession(authCode);
      if (exchange) throw exchange;
    });

  const devSignIn = () =>
    run('dev', async () => {
      if (!name.trim() || !email.trim()) throw new Error('Name and email are both required.');
      try {
        await signIn(email, name);
      } catch (err) {
        throw new Error(err instanceof ApiError ? err.message : 'Could not sign in.');
      }
    });

  return (
    <View style={styles.page}>
      <Appear>
      <View style={styles.column}>
        <Text style={styles.mark}>Travel OS</Text>
        <Text style={styles.lead}>
          One place for the trip you are planning, the stay you are living, and the records you already have.
        </Text>

        {supabase ? (
          <>
            {appleReady ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={14}
                style={styles.apple}
                onPress={apple}
              />
            ) : null}
            <Button label="Continue with Google" tone="quiet" onPress={google} busy={busy === 'google'} />
            <Text style={styles.or}>or use your email</Text>
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            {codeSent ? (
              <>
                <Field label="6-digit code" value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" />
                <Button label="Sign in" onPress={verifyCode} busy={busy === 'verify'} />
                <Pressable onPress={sendCode}>
                  <Text style={styles.link}>Send a new code</Text>
                </Pressable>
              </>
            ) : (
              <Button label="Email me a code" onPress={sendCode} busy={busy === 'code'} />
            )}
          </>
        ) : null}

        {devAllowed && supabase && !showDev ? (
          <Pressable onPress={() => setShowDev(true)}>
            <Text style={styles.link}>Developer sign-in</Text>
          </Pressable>
        ) : null}

        {devAllowed && showDev ? (
          <>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Andre" />
            {supabase ? null : <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />}
            <Button label="Continue" onPress={devSignIn} busy={busy === 'dev'} />
            <Text style={styles.note}>Development sign-in: email only, for testing. Not available in store builds.</Text>
          </>
        ) : null}

        <ErrorNote message={error} />
      </View>
      </Appear>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    width: '100%',
    minHeight: Platform.OS === 'web' ? '100vh' : undefined,
    backgroundColor: theme.paper,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  column: { width: '100%', maxWidth: 460, gap: 14 },
  mark: { fontFamily: serif, fontSize: 42, color: theme.ink },
  lead: { color: theme.muted, fontSize: 17, lineHeight: 24, marginBottom: 8 },
  apple: { width: '100%', height: 50 },
  or: { color: theme.muted, textAlign: 'center', marginVertical: 4 },
  link: { color: theme.moss, fontWeight: '700', textAlign: 'center', paddingVertical: 6 },
  note: { color: theme.muted, fontSize: 13, lineHeight: 18 },
});
