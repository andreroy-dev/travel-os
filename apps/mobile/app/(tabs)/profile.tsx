import { useCallback, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { useSession } from '@/lib/session';
import type { Integration } from '@/lib/types';

const later = ['Currency', 'Time zones', 'Translate', 'Weather', 'eSIM', 'Packing', 'Flight status', 'Emergency'];

export default function ProfileScreen() {
  const { token, user, signOut } = useSession();
  const router = useRouter();
  const [gmail, setGmail] = useState<string>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  async function exportData() {
    if (!token) return;
    setBusy('export');
    try {
      const data = await api<unknown>('/users/me/export', { token });
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'travel-os-export.json';
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: 'Travel OS export', message: json });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not export your data.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!token) return;
    const first = await confirmAction(
      'Delete your account?',
      'This permanently deletes your Travel Spaces, bookings, itinerary, saved places and assistant history, and disconnects Gmail. It cannot be undone. Bookings with airlines and hotels are not affected.',
      'Continue',
    );
    if (!first) return;
    const second = await confirmAction('Are you sure?', 'Your account and all its data will be deleted now.', 'Delete account');
    if (!second) return;
    setBusy('delete');
    try {
      await api('/users/me', { method: 'DELETE', token });
      await signOut();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete your account.');
      setBusy(null);
    }
  }

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
      <Text style={styles.section}>Your data</Text>
      <Button label="Export my data" tone="quiet" onPress={exportData} busy={busy === 'export'} />
      <Button label="Sign out" tone="quiet" onPress={signOut} />
      <Pressable onPress={deleteAccount} disabled={busy !== null} style={styles.delete}>
        <Text style={styles.deleteLabel}>{busy === 'delete' ? 'Deleting…' : 'Delete account'}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 28, fontWeight: '700', color: theme.ink },
  plan: { color: theme.moss, fontWeight: '700', fontSize: 16 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  util: { width: '22%', minWidth: 72, backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center' },
  delete: { alignItems: 'center', paddingVertical: 14 },
  deleteLabel: { color: theme.danger, fontWeight: '700' },
  utilLabel: { fontSize: 11, textAlign: 'center', color: theme.ink },
});
