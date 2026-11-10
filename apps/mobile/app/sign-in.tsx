import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorNote, Field, serif, theme } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function SignInScreen() {
  const { signIn } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('Name and email are both required.');
      return;
    }
    setBusy(true);
    try {
      await signIn(email, name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.column}>
        <Text style={styles.mark}>Travel OS</Text>
        <Text style={styles.lead}>
          One place for the trip you are planning, the stay you are living, and the records you already have.
        </Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Andre" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
        <ErrorNote message={error} />
        <Button label="Continue" onPress={submit} busy={busy} />
        <Text style={styles.note}>
          Development sign-in creates your account on this API. Bookings still happen with your own providers.
        </Text>
      </View>
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
  note: { color: theme.muted, fontSize: 13, lineHeight: 18 },
});
