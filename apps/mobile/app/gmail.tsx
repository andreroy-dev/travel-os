import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Integration } from '@/lib/types';

export default function GmailScreen() {
  const { token } = useSession();
  const [gmail, setGmail] = useState<Integration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setGmail(await api<Integration>('/integrations/gmail', { token }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Gmail.');
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  async function connect() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const returnTo = Linking.createURL('/gmail');
      const result = await api<{ authorization_url: string }>('/integrations/gmail/connect', {
        method: 'POST',
        token,
        body: { return_to: returnTo },
      });
      await WebBrowser.openAuthSessionAsync(result.authorization_url, returnTo);
      const latest = await api<Integration>('/integrations/gmail', { token });
      setGmail(latest);
      setNotice(
        latest.status === 'connected'
          ? 'Gmail is connected. Open a Travel Space and sync bookings and itinerary.'
          : 'Google did not finish connecting. Approve access, wait for the Travel OS page, then close it.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gmail could not be connected.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api('/integrations/gmail', { method: 'DELETE', token });
      setNotice('Gmail is disconnected. Bookings already saved stay where they are.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect Gmail.');
    } finally {
      setBusy(false);
    }
  }

  const connected = gmail?.status === 'connected';

  return (
    <Screen onRefresh={load}>
      <Text style={styles.title}>Gmail</Text>
      <Muted>
        Connect once. After that, open a Travel Space and sync. Travel OS reads booking emails for that place and keeps the ones whose travel dates fall inside the space.
      </Muted>
      <Card>
        <Text style={styles.status}>Status · {gmail?.status ?? 'unknown'}</Text>
        <Muted>{connected ? 'Read-only access is on.' : 'Not connected.'}</Muted>
      </Card>
      <ErrorNote message={error} />
      {notice ? <Muted>{notice}</Muted> : null}
      {connected ? null : <Button label="Connect Gmail" onPress={connect} busy={busy} />}
      {connected ? <Button label="Disconnect" tone="quiet" onPress={disconnect} busy={busy} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: '700', color: theme.ink },
  status: { fontSize: 16, fontWeight: '700', color: theme.ink, textTransform: 'capitalize' },
});
