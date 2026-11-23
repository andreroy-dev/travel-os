import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

/** Pick another space (active or archived) and move everything in it into this one. */
export default function MergeSpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const router = useRouter();
  const [target, setTarget] = useState<TravelSpace | null>(null);
  const [others, setOthers] = useState<TravelSpace[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    Promise.all([
      api<TravelSpace>(`/travel-spaces/${id}`, { token }),
      api<TravelSpace[]>('/travel-spaces', { token }),
      api<TravelSpace[]>('/travel-spaces?archived=true', { token }),
    ])
      .then(([space, live, archived]) => {
        setTarget(space);
        setOthers([...live, ...archived].filter((item) => item.id !== id));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load spaces.'));
  }, [token, id]);

  async function merge(source: TravelSpace) {
    if (!token || !target) return;
    const ok = await confirmAction(
      `Merge "${source.title}" into "${target.title}"?`,
      `All bookings, stays, journeys and saved places from "${source.title}" move into "${target.title}", and the dates widen to cover both. "${source.title}" is then archived (empty), not deleted.`,
      'Merge',
    );
    if (!ok) return;
    try {
      await api(`/travel-spaces/${target.id}/merge`, { method: 'POST', token, body: { from_space_id: source.id } });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not merge these spaces.');
    }
  }

  return (
    <Screen>
      <Muted>
        Choose a space to bring into {target ? `"${target.title}"` : 'this space'}. Useful when the same trip was created twice.
      </Muted>
      <ErrorNote message={error} />
      {others.map((space) => (
        <Pressable key={space.id} onPress={() => merge(space)} style={styles.card}>
          <Text style={styles.badge}>{space.status}</Text>
          <Text style={styles.title}>{space.title}</Text>
          <Muted>{[space.start_date, space.end_date].filter(Boolean).join(' – ') || 'No dates'}</Muted>
        </Pressable>
      ))}
      {others.length === 0 ? <Muted>No other spaces to merge.</Muted> : null}
      <View />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 4, borderWidth: 1, borderColor: theme.line },
  badge: { color: theme.moss, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: theme.ink, fontSize: 18, fontWeight: '700' },
});
