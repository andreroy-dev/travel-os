import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorNote, Field, Muted, Screen } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { IngestResult } from '@/lib/types';

export default function ImportConfirmationScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        Paste the confirmation text. Travel OS extracts a booking when the fields are reliable, and asks you to review it when they are not.
      </Muted>
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Your booking confirmation" />
      <Field label="Email" value={body} onChangeText={setBody} multiline placeholder="Paste the message" />
      <ErrorNote message={error} />
      {result ? <Muted>{result}</Muted> : null}
      <Button label="Import" onPress={submit} busy={busy} />
    </Screen>
  );
}
