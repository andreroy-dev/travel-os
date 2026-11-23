import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

const filters = ['all', 'active', 'planning', 'completed', 'archived'] as const;

export default function TripsScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [archived, setArchived] = useState<TravelSpace[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number]>('all');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [live, old] = await Promise.all([
        api<TravelSpace[]>('/travel-spaces', { token }),
        api<TravelSpace[]>('/travel-spaces?archived=true', { token }),
      ]);
      setSpaces(live);
      setArchived(old);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load trips.');
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  async function restore(space: TravelSpace) {
    if (!token) return;
    const ok = await confirmAction(
      'Restore this space?',
      `"${space.title}" will move back to your Travel Spaces with all its bookings.`,
      'Restore',
    );
    if (!ok) return;
    try {
      await api(`/travel-spaces/${space.id}/restore`, { method: 'POST', token, body: {} });
      setFilter('all');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore this space.');
    }
  }

  const visible = (filter === 'archived' ? archived : spaces).filter((space) => {
    if (filter === 'all' || filter === 'archived') return true;
    if (filter === 'active') return space.status === 'active' || space.status === 'upcoming';
    return space.status === filter;
  });

  return (
    <Screen safeTop onRefresh={load} refreshing={refreshing}>
      <View style={styles.top}>
        <View>
          <Text style={styles.title}>Travel Spaces</Text>
          <Muted>Trips, stays and journeys — any length</Muted>
        </View>
        <Pressable style={styles.add} onPress={() => router.push('/new-space')}>
          <Text style={styles.addLabel}>+</Text>
        </Pressable>
      </View>
      <View style={styles.filters}>
        {filters.map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterOn]}>
            <Text style={[styles.filterText, filter === item && styles.filterTextOn]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <Button label="Connect Gmail" tone="quiet" onPress={() => router.push('/gmail')} />
      {error ? <Muted>{error}</Muted> : null}
      {visible.map((space) => {
        const featured = space.status === 'active';
        return (
          <Pressable key={space.id} onPress={() => router.push(`/spaces/${space.id}`)} style={[styles.card, featured && styles.featured]}>
            <View style={styles.row}>
              <Text style={[styles.badge, featured && styles.badgeOn]}>{space.status}</Text>
              <Text style={[styles.meta, featured && styles.onDark]}>{space.start_date ?? 'No dates yet'}</Text>
            </View>
            <Text style={[styles.cardTitle, featured && styles.onDark]}>{space.title}</Text>
            <Text style={[styles.meta, featured && styles.onDark]}>
              {[space.destination_name, space.kind.replaceAll('_', ' ')].filter(Boolean).join(' · ')}
            </Text>
            {space.status === 'archived' ? (
              <Pressable onPress={() => restore(space)} style={styles.restore}>
                <Text style={styles.restoreLabel}>Restore to active</Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
      {visible.length === 0 ? (
        <Muted>{filter === 'archived' ? 'Nothing archived. Archived spaces show up here and can be restored.' : 'No Travel Spaces in this filter.'}</Muted>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 32, fontWeight: '700', color: theme.ink },
  add: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.clay, alignItems: 'center', justifyContent: 'center' },
  addLabel: { color: '#fff', fontSize: 28, lineHeight: 30 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  restore: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: theme.moss, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  restoreLabel: { color: '#fff', fontWeight: '700' },
  filter: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  filterOn: { backgroundColor: theme.moss },
  filterText: { color: theme.ink, textTransform: 'capitalize', fontWeight: '600' },
  filterTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 16, gap: 6, borderWidth: 1, borderColor: theme.line },
  featured: { backgroundColor: theme.mossDeep, borderColor: theme.mossDeep },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  badge: { color: theme.moss, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  badgeOn: { color: theme.clay },
  cardTitle: { fontSize: 22, fontWeight: '700', color: theme.ink },
  meta: { color: theme.muted },
  onDark: { color: '#e7f3ee' },
});
