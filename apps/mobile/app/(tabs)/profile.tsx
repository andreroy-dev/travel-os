import { useCallback, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { CurrencyPicker, TimeZonePicker } from '@/components/Pickers';
import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { currencyByCode } from '@/lib/currencies';
import { accountName, connectGmail } from '@/lib/gmail';
import { useSession } from '@/lib/session';
import type { Integration } from '@/lib/types';

type Preferences = {
  home_currency: string;
  locale: string;
  timezone: string;
  budget_level: string | null;
  travel_style: string | null;
  interests: string[];
  food_preferences: string[];
  accommodation_preferences: string[];
  accessibility_notes: string | null;
  notifications_enabled: boolean;
};

export default function ProfileScreen() {
  const { token, user, signOut } = useSession();
  const router = useRouter();
  const [gmail, setGmail] = useState<Integration | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('UTC');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'export' | 'delete' | 'prefs' | null>(null);
  const [editing, setEditing] = useState<'currency' | 'zone' | null>(null);

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
      const [integration, address, preferences] = await Promise.all([
        api<Integration>('/integrations/gmail', { token }),
        api<{ address: string | null; available: boolean }>('/users/me/forwarding', { token }),
        api<Preferences>('/preferences', { token }),
      ]);
      setGmail(integration);
      setForwarding(address.address);
      setPrefs(preferences);
      setCurrency(preferences.home_currency);
      setTimezone(preferences.timezone);
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
      <View style={styles.grid}>
        {(
          [
            ['Currency', () => setEditing('currency')],
            ['Time zone', () => setEditing('zone')],
            ['Emergency', () => router.push('/wallet')],
            ['Tools', () => router.push('/tools')],
          ] as const
        ).map(([label, action]) => (
          <Pressable key={label} onPress={action} style={styles.util}>
            <Text style={styles.utilLabel}>{label}</Text>
            <Text style={styles.utilValue}>
              {label === 'Currency'
                ? `${currencyByCode(currency)?.flag ?? ''} ${currencyByCode(currency)?.name ?? currency}`
                : label === 'Time zone'
                  ? timezone.split('/').pop()
                  : label === 'Tools'
                    ? 'Packing, clocks'
                    : 'Wallet'}
            </Text>
          </Pressable>
        ))}
      </View>
      {forwarding ? (
        <>
          <Text style={styles.section}>Forward confirmations</Text>
          <Card>
            <Text style={styles.plan}>{forwarding}</Text>
            <Muted>Forward booking emails here from any inbox. They are read with the same confirmation parser as Gmail.</Muted>
          </Card>
          <Button label="Share forwarding address" tone="quiet" onPress={() => Share.share({ message: forwarding })} />
        </>
      ) : null}
      <Button label="Import a PDF or pasted confirmation" tone="quiet" onPress={() => router.push('/import-confirmation')} />
      <Text style={styles.section}>Travel preferences</Text>
      <Pressable
        onPress={async () => {
          if (!token || !prefs) return;
          const next = { ...prefs, notifications_enabled: !prefs.notifications_enabled };
          setPrefs(next);
          try {
            setPrefs(await api<Preferences>('/preferences', { method: 'PUT', token, body: { ...next, home_currency: currency, timezone } }));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save settings.');
          }
        }}
        style={styles.util}>
        <Text style={styles.utilLabel}>Reminders {prefs?.notifications_enabled === false ? 'off' : 'on'}</Text>
      </Pressable>
      <CurrencyPicker
        value={currency}
        opened={editing === 'currency'}
        onClose={() => setEditing(null)}
        onChange={async (next) => {
          setCurrency(next);
          if (!token || !prefs) return;
          setBusy('prefs');
          try {
            setPrefs(await api<Preferences>('/preferences', { method: 'PUT', token, body: { ...prefs, home_currency: next, timezone } }));
            setEditing(null);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save settings.');
          } finally {
            setBusy(null);
          }
        }}
      />
      <TimeZonePicker
        value={timezone}
        opened={editing === 'zone'}
        onClose={() => setEditing(null)}
        onChange={async (next) => {
          setTimezone(next);
          if (!token || !prefs) return;
          setBusy('prefs');
          try {
            setPrefs(await api<Preferences>('/preferences', { method: 'PUT', token, body: { ...prefs, home_currency: currency, timezone: next } }));
            setEditing(null);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save settings.');
          } finally {
            setBusy(null);
          }
        }}
      />
      <Card>
        <Pressable onPress={() => router.push('/gmail')} style={{ gap: 6 }}>
          <Text style={styles.plan}>Gmail</Text>
          {gmail && gmail.accounts.length === 0 ? <Muted>Not connected. Connect the inbox your booking emails go to.</Muted> : null}
          {(gmail?.accounts ?? []).map((account) => (
            <View key={account.id} style={styles.mailRow}>
              <View style={[styles.mailDot, account.status !== 'connected' && styles.mailDotOff]} />
              <Text style={styles.mailText} numberOfLines={1}>
                {accountName(account.email)}
              </Text>
              {account.status !== 'connected' ? <Text style={styles.mailOff}>Reconnect</Text> : null}
            </View>
          ))}
        </Pressable>
        <Button
          label={gmail?.accounts.length ? 'Add another Gmail account' : 'Connect Gmail'}
          tone="quiet"
          busy={connecting}
          onPress={async () => {
            if (!token) return;
            setConnecting(true);
            setError(null);
            try {
              setGmail((await connectGmail(token)).gmail);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Gmail could not be connected.');
            } finally {
              setConnecting(false);
            }
          }}
        />
      </Card>
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
  mailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mailDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.moss },
  mailDotOff: { backgroundColor: theme.danger },
  mailText: { flex: 1, color: theme.ink, fontWeight: '600', fontSize: 15 },
  mailOff: { color: theme.danger, fontWeight: '700', fontSize: 13 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  util: { flex: 1, minWidth: 96, backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4, borderWidth: 1, borderColor: theme.line },
  utilValue: { color: theme.moss, fontWeight: '700', fontSize: 13 },
  delete: { alignItems: 'center', paddingVertical: 14 },
  deleteLabel: { color: theme.danger, fontWeight: '700' },
  utilLabel: { fontSize: 11, textAlign: 'center', color: theme.ink },
});
