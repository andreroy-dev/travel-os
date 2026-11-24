import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/motion';

import { ChoicePicker } from '@/components/Pickers';
import { Sheet } from '@/components/Sheet';
import { DateField, isoDate } from '@/components/DateField';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { loadCached } from '@/lib/cache';
import { success } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { documentKinds, uploadWalletFile, type WalletDocument } from '@/lib/walletFiles';

type Document = WalletDocument;
type Contact = { id: string; name: string; phone: string; relationship: string | null };
type VisaLog = { id: string; label: string; count: { used_days: number; remaining_days: number; disclaimer: string } };

const kinds = documentKinds;

const labels = Object.fromEntries(kinds);
const featured = ['passport', 'visa', 'insurance', 'international_driving_permit', 'driving_licence', 'boarding_pass'];

function daysUntil(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${value}T00:00:00`).getTime() - today.getTime()) / 86400000);
}

export default function WalletScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [visas, setVisas] = useState<VisaLog[]>([]);
  const [kind, setKind] = useState<(typeof kinds)[number][0]>('passport');
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [expires, setExpires] = useState<Date | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [docs, people, logs] = await loadCached(`wallet:${token}`, () => Promise.all([
      api<Document[]>('/wallet/documents', { token }),
      api<Contact[]>('/wallet/contacts', { token }),
      api<VisaLog[]>('/living/visa-logs', { token }),
    ]));
    setDocuments(docs);
    setContacts(people);
    setVisas(logs);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your wallet.'));
    }, [load]),
  );

  /** Pick a file from the camera, photos or Files, then upload it with the chosen type. */
  async function upload(source: 'camera' | 'photos' | 'files') {
    if (!token) return;
    setError(null);
    let file: { uri: string; name: string; type: string } | null = null;
    if (source === 'files') {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      file = { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/pdf' };
    } else {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Allow camera access in Settings to scan a document.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85 };
      const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      file = { uri: asset.uri, name: asset.fileName ?? `${kind}.jpg`, type: asset.mimeType ?? 'image/jpeg' };
    }
    setBusy(true);
    try {
      const saved = await uploadWalletFile(token, file, {
        kind,
        title: title || undefined,
        expires_on: expires ? isoDate(expires) : null,
      });
      success();
      setTitle('');
      setReference('');
      setExpires(null);
      setAdding(false);
      await load();
      router.push({ pathname: '/document/[id]', params: { id: saved.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that file.');
    } finally {
      setBusy(false);
    }
  }

  async function addDocument() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api('/wallet/documents', {
        token,
        body: { kind, title, reference: reference || null, expires_on: expires ? isoDate(expires) : null },
      });
      setTitle('');
      setReference('');
      setExpires(null);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that document.');
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api('/wallet/contacts', { token, body: { name, phone } });
      setName('');
      setPhone('');
      setAddingContact(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that contact.');
    } finally {
      setBusy(false);
    }
  }

  const cards = featured
    .map((value) => documents.find((document) => document.kind === value))
    .filter((document): document is Document => Boolean(document));
  const soon = documents.filter((document) => document.expires_on && daysUntil(document.expires_on) <= 30);
  const stay = visas[0];

  return (
    <Screen onRefresh={load} refreshing={busy}>
      <Text style={styles.heading}>Travel Wallet</Text>
      <ErrorNote message={error} />
      <View style={styles.grid}>
        {(cards.length ? cards : documents.slice(0, 4)).map((document) => {
          const left = document.expires_on ? daysUntil(document.expires_on) : null;
          const warn = left !== null && left <= 30;
          return (
            <PressableScale
              key={document.id}
              onPress={() => router.push({ pathname: '/document/[id]', params: { id: document.id } })}
              style={[styles.tile, document.kind === 'passport' && styles.tileOn]}>
              <Text style={[styles.kicker, document.kind === 'passport' && styles.onDark]}>{labels[document.kind] ?? document.kind}</Text>
              <Text style={[styles.tileTitle, document.kind === 'passport' && styles.onDark]}>{document.title}</Text>
              <Text style={[styles.meta, warn && styles.warn, document.kind === 'passport' && styles.onDark]}>
                {document.expires_on
                  ? left !== null && left >= 0
                    ? `Dated ${document.expires_on} · ${left} days`
                    : `Dated ${document.expires_on}`
                  : document.has_file
                    ? 'Tap to show'
                    : document.reference ?? 'Saved by you'}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      {documents.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.title}>Keep your documents with you</Text>
          <Muted>Scan or upload your passport, visas, insurance and driving permits. They open here, even offline, when you need to show them.</Muted>
        </View>
      ) : null}
      {stay ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.title}>{stay.label}</Text>
            <Text style={styles.moss}>{stay.count.remaining_days} days left in the log</Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(100, (stay.count.used_days / Math.max(stay.count.used_days + stay.count.remaining_days, 1)) * 100)}%`,
                },
              ]}
            />
          </View>
          <Muted>
            {stay.count.used_days} days counted. {stay.count.disclaimer}
          </Muted>
        </View>
      ) : null}
      {soon.map((document) => (
        <View key={`soon-${document.id}`} style={styles.alert}>
          <Text style={styles.title}>{document.title} is dated {document.expires_on} in the record you saved.</Text>
        </View>
      ))}
      <Text style={styles.section}>All documents</Text>
      {documents.map((document) => (
        <PressableScale
          key={`list-${document.id}`}
          onPress={() => router.push({ pathname: '/document/[id]', params: { id: document.id } })}
          style={styles.line}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{document.title}</Text>
              <Text style={styles.meta}>
                {[labels[document.kind] ?? document.kind, document.has_file ? (document.content_type === 'application/pdf' ? 'PDF' : 'Photo') : 'Details only']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Text style={styles.moss}>Show ›</Text>
          </View>
        </PressableScale>
      ))}
      <Button label="Add a document" onPress={() => setAdding(true)} />
      <Sheet visible={adding} title="Add a document" onClose={() => setAdding(false)}>
        <ChoicePicker
          label="Type"
          value={kind}
          options={kinds.map(([value, label]) => ({ value, label }))}
          onChange={(value) => setKind(value as (typeof kinds)[number][0])}
        />
        <View style={styles.sources}>
          {(
            [
              ['camera', 'Scan with camera'],
              ['photos', 'Choose a photo'],
              ['files', 'Choose a PDF or file'],
            ] as const
          ).map(([source, label]) => (
            <PressableScale key={source} onPress={() => void upload(source)} disabled={busy} style={styles.source}>
              <Text style={styles.sourceText}>{label}</Text>
            </PressableScale>
          ))}
        </View>
        <Muted>Optional details, used for reminders before it expires:</Muted>
        <Field label="Name" value={title} onChangeText={setTitle} placeholder={labels[kind] ?? 'Document'} />
        <DateField label="Valid until" value={expires} onChange={setExpires} placeholder="Choose a date" />
        <Field label="Number" value={reference} onChangeText={setReference} placeholder="Only if you want it searchable" />
        <Button label="Save details without a file" tone="quiet" onPress={addDocument} busy={busy} />
      </Sheet>
      <Text style={styles.section}>Emergency contacts</Text>
      {contacts.map((contact) => (
        <View key={contact.id} style={styles.line}>
          <Text style={styles.title}>{contact.name}</Text>
          <Muted>{contact.phone}</Muted>
        </View>
      ))}
      <Button label="Add contact" tone="quiet" onPress={() => setAddingContact(true)} />
      <Sheet visible={addingContact} title="Emergency contact" onClose={() => setAddingContact(false)}>
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button label="Save contact" onPress={addContact} busy={busy} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: theme.mossSoft, borderRadius: 18, padding: 16, gap: 6 },
  sources: { gap: 8 },
  source: { backgroundColor: theme.moss, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sourceText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  heading: { fontSize: 28, fontWeight: '700', color: theme.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6, minHeight: 110, borderWidth: 1, borderColor: theme.line },
  tileOn: { backgroundColor: theme.mossDeep, borderColor: theme.mossDeep },
  tileTitle: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  kicker: { color: theme.moss, fontWeight: '700', fontSize: 12 },
  meta: { color: theme.muted, fontSize: 13 },
  warn: { color: theme.clay, fontWeight: '700' },
  onDark: { color: '#e7f3ee' },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 8, borderWidth: 1, borderColor: theme.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  title: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  moss: { color: theme.moss, fontWeight: '700' },
  track: { height: 8, borderRadius: 99, backgroundColor: theme.line, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: theme.moss },
  alert: { backgroundColor: theme.coralSoft, borderRadius: 16, padding: 14 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink, marginTop: 8 },
  line: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 2, borderWidth: 1, borderColor: theme.line },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: theme.paper, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipOn: { backgroundColor: theme.moss },
  off: { color: theme.ink, fontWeight: '600' },
  on: { color: '#fff', fontWeight: '600' },
});
