import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Appear, PressableScale } from '@/components/motion';
import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { prettyDay } from '@/lib/dates';
import { accountName, connectGmail, loadGmail } from '@/lib/gmail';
import { success } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import type { GmailAccount, Integration } from '@/lib/types';

/** Every Gmail inbox Travel OS reads bookings from. Add as many as you use for travel mail. */
export default function GmailScreen() {
  const { token } = useSession();
  const [gmail, setGmail] = useState<Integration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setGmail(await loadGmail(token));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Gmail.');
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  async function connect(key: string) {
    if (!token) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const { gmail: latest, added } = await connectGmail(token);
      setGmail(latest);
      if (added) {
        success();
        setNotice(`${added} is connected. Sync from any Travel Space to file its bookings.`);
      } else if (latest.status === 'connected') {
        setNotice('No new account was added. To add another inbox, pick a different Google account on the next screen.');
      } else {
        setNotice('Google did not finish connecting. Approve access, wait for the Travel OS page, then close it.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gmail could not be connected.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(account: GmailAccount) {
    if (!token) return;
    const ok = await confirmAction(
      `Disconnect ${accountName(account.email)}?`,
      'Travel OS stops reading this inbox. Bookings already saved from it stay where they are.',
      'Disconnect',
    );
    if (!ok) return;
    setBusy(account.id);
    setError(null);
    try {
      await api(`/integrations/gmail/${account.id}`, { method: 'DELETE', token });
      setNotice(`${accountName(account.email)} is disconnected.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect Gmail.');
    } finally {
      setBusy(null);
    }
  }

  const accounts = gmail?.accounts ?? [];

  return (
    <Screen onRefresh={load}>
      <Text style={styles.title}>Gmail</Text>
      <Muted>
        Travel OS reads booking confirmations from these inboxes, read-only. Open a Travel Space and tap Sync Gmail to file bookings from every inbox below.
      </Muted>
      {gmail && accounts.length === 0 ? (
        <Card>
          <Text style={styles.email}>No Gmail connected</Text>
          <Muted>Connect the inbox your flight and hotel confirmations go to.</Muted>
        </Card>
      ) : null}
      {accounts.map((account, index) => {
        const broken = account.status !== 'connected';
        return (
          <Appear key={account.id} index={index}>
            <View style={styles.account}>
              <View style={styles.accountTop}>
                <View style={[styles.dot, broken && styles.dotOff]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.email} numberOfLines={1}>
                    {accountName(account.email)}
                  </Text>
                  <Text style={[styles.meta, broken && styles.metaOff]}>
                    {broken
                      ? 'Access stopped. Reconnect to keep syncing.'
                      : account.last_synced_at
                        ? `Connected · last synced ${prettyDay(account.last_synced_at)}`
                        : 'Connected · not synced yet'}
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                {broken ? (
                  <PressableScale onPress={() => void connect(account.id)} style={styles.pill} accessibilityLabel="Reconnect">
                    <Text style={styles.pillText}>{busy === account.id ? '…' : 'Reconnect'}</Text>
                  </PressableScale>
                ) : null}
                <PressableScale
                  onPress={() => void disconnect(account)}
                  style={[styles.pill, styles.pillQuiet]}
                  accessibilityLabel={`Disconnect ${accountName(account.email)}`}>
                  <Text style={[styles.pillText, styles.pillQuietText]}>{busy === account.id ? '…' : 'Disconnect'}</Text>
                </PressableScale>
              </View>
            </View>
          </Appear>
        );
      })}
      <ErrorNote message={error} />
      {notice ? <Muted>{notice}</Muted> : null}
      {gmail ? (
        <Button
          label={accounts.length ? 'Add another Gmail account' : 'Connect Gmail'}
          tone={accounts.length ? 'quiet' : undefined}
          onPress={() => void connect('add')}
          busy={busy === 'add'}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: '700', color: theme.ink },
  account: {
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 14,
  },
  accountTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.moss },
  dotOff: { backgroundColor: theme.danger },
  email: { fontSize: 16, fontWeight: '700', color: theme.ink },
  meta: { color: theme.muted, fontSize: 13 },
  metaOff: { color: theme.danger },
  pill: { backgroundColor: theme.moss, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  pillQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.line },
  pillQuietText: { color: theme.ink },
});
