import * as Sharing from 'expo-sharing';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { PressableScale } from '@/components/motion';
import { theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { prettyDate } from '@/lib/dates';
import { useSession } from '@/lib/session';
import { forgetLocalCopy, kindLabel, localCopy, type WalletDocument } from '@/lib/walletFiles';

/** Full-screen document, ready to hand over at a desk or border. Works offline after the first open. */
export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [doc, setDoc] = useState<WalletDocument | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    (async () => {
      try {
        const all = await api<WalletDocument[]>('/wallet/documents', { token });
        const found = all.find((item) => item.id === id) ?? null;
        setDoc(found);
        if (found?.has_file) setFile(await localCopy(token, found));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not open that document.');
      }
    })();
  }, [id, token]);

  async function remove() {
    if (!token || !doc) return;
    const ok = await confirmAction('Delete this document?', `"${doc.title}" and its file will be removed from your wallet.`, 'Delete');
    if (!ok) return;
    await api(`/wallet/documents/${doc.id}`, { method: 'DELETE', token });
    await forgetLocalCopy(doc);
    router.back();
  }

  const isPdf = doc?.content_type === 'application/pdf';

  return (
    <View style={[styles.page, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <PressableScale onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>Done</Text>
        </PressableScale>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {file ? (
            <PressableScale onPress={() => void Sharing.shareAsync(file)} style={styles.pill}>
              <Text style={styles.pillText}>Share</Text>
            </PressableScale>
          ) : null}
          {doc ? (
            <PressableScale onPress={() => void remove()} style={styles.pill}>
              <Text style={[styles.pillText, { color: '#ff9b85' }]}>Delete</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
      <View style={styles.head}>
        <Text style={styles.kind}>{doc ? kindLabel[doc.kind] ?? doc.kind : ' '}</Text>
        <Text style={styles.title}>{doc?.title ?? ''}</Text>
        {doc?.expires_on ? <Text style={styles.meta}>Valid until {prettyDate(doc.expires_on)}</Text> : null}
      </View>
      <View style={styles.body}>
        {error ? <Text style={styles.meta}>{error}</Text> : null}
        {!error && doc && !doc.has_file ? (
          <Text style={styles.meta}>No file attached. {doc.reference ? `Number ${doc.reference}.` : ''}</Text>
        ) : null}
        {!error && doc?.has_file && !file ? <ActivityIndicator color="#fff" /> : null}
        {file && !isPdf ? <Image source={{ uri: file }} style={styles.fill} resizeMode="contain" /> : null}
        {file && isPdf && Platform.OS === 'ios' ? (
          <WebView source={{ uri: file }} originWhitelist={['file://*']} allowFileAccess style={styles.pdf} />
        ) : null}
        {file && isPdf && Platform.OS !== 'ios' ? (
          <PressableScale onPress={() => void Sharing.shareAsync(file, { mimeType: 'application/pdf' })} style={styles.open}>
            <Text style={styles.openText}>Open PDF</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0d1512', gap: 12 },
  top: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  pill: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pillText: { color: '#fff', fontWeight: '700' },
  head: { paddingHorizontal: 20, gap: 2 },
  kind: { color: theme.clay, fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  meta: { color: '#b7c4be' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  fill: { width: '100%', height: '100%' },
  pdf: { flex: 1, width: '100%', alignSelf: 'stretch', borderRadius: 12, backgroundColor: '#fff' },
  open: { backgroundColor: theme.moss, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  openText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
