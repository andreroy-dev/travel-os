import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorNote, Field, Muted, Screen } from '@/components/ui';
import { ApiError, api, uploadDocument } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { IngestResult } from '@/lib/types';

export default function ImportConfirmationScreen() {
  const { token } = useSession();
  const router = useRouter();
  const { space } = useLocalSearchParams<{ space?: string }>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickPhoto() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (picked.canceled || !picked.assets[0]) return;
      const file = picked.assets[0];
      const ingested = await uploadDocument(
        token,
        { uri: file.uri, name: file.fileName ?? 'screenshot.jpg', type: file.mimeType ?? 'image/jpeg' },
        space,
      );
      setResult(ingested.detail || 'A photo cannot be read as a booking yet. Paste the confirmation text or upload a PDF.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import that photo.');
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'message/rfc822'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const file = picked.assets[0];
      const ingested = await uploadDocument(
        token,
        { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' },
        space,
      );
      setResult(`${ingested.status}: ${ingested.detail}`);
      if (ingested.booking_id) router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import that file.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const ingested = await api<IngestResult>('/emails/import', {
        token,
        body: {
          external_id: `paste:${Date.now()}`,
          subject,
          body,
        },
      });
      setResult(`${ingested.classification}: ${ingested.detail}`);
      if (ingested.booking_id) router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that confirmation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Muted>
        Upload a PDF or text confirmation, or paste the email. A booking is saved only when the confirmation number and dates are in the file.
      </Muted>
      <Button label="Choose a PDF or text file" tone="quiet" onPress={pickFile} busy={busy} />
      <Button label="Choose a screenshot" tone="quiet" onPress={pickPhoto} busy={busy} />
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Your booking confirmation" />
      <Field label="Email" value={body} onChangeText={setBody} multiline placeholder="Paste the message" />
      <ErrorNote message={error} />
      {result ? <Muted>{result}</Muted> : null}
      <Button label="Import" onPress={submit} busy={busy} />
    </Screen>
  );
}
