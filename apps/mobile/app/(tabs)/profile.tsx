import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Integration } from '@/lib/types';

const later = ['Currency', 'Time zones', 'Translate', 'Weather', 'eSIM', 'Packing', 'Flight status', 'Emergency'];

export default function ProfileScreen() {
  const { token, user, signOut } = useSession();
  const router = useRouter();
  const [gmail, setGmail] = useState<string>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const integration = await api<Integration>('/integrations/gmail', { token });
      setGmail(integration.status);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load profile.');
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <Screen safeTop>
      <Text style={styles.name}>{user?.display_name ?? 'Traveller'}</Text>
      <Muted>{user?.email}</Muted>
      <Card>
        <Text style={styles.plan}>Free plan</Text>
        <Muted>Organization tools are available. Premium is not for sale in this version.</Muted>
      </Card>
      <Text style={styles.section}>Utilities</Text>
      <View style={styles.grid}>
        {later.map((item) => (
          <View key={item} style={styles.util}>
            <Text style={styles.utilLabel}>{item}</Text>
          </View>
        ))}
      </View>
      <Muted>These tools are in the design and are not connected yet.</Muted>
      <Pressable onPress={() => router.push('/gmail')}>
        <Card>
          <Text style={styles.plan}>Gmail · {gmail}</Text>
          <Muted>Connect Gmail here. Sync bookings from inside a Travel Space.</Muted>
        </Card>
      </Pressable>
      <ErrorNote message={error} />
      <Button label="Sign out" tone="quiet" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 28, fontWeight: '700', color: theme.ink },
  plan: { color: theme.moss, fontWeight: '700', fontSize: 16 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  util: { width: '22%', minWidth: 72, backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center' },
  utilLabel: { fontSize: 11, textAlign: 'center', color: theme.ink },
});
