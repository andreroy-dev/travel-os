import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Appear, PressableScale, SharedTitle, SkeletonList } from '@/components/motion';
import { Button, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { loadCached } from '@/lib/cache';
import { confirmAction } from '@/lib/confirm';
import { prettyDate, prettyDay } from '@/lib/dates';
import { loadGmail } from '@/lib/gmail';
import { useSession } from '@/lib/session';
import type { Booking, TravelSpace } from '@/lib/types';

const filters = ['all', 'active', 'planning', 'completed', 'archived'] as const;
const filterLabels = { all: 'All', active: 'Active', planning: 'Planning', completed: 'Completed', archived: 'Archived' } as const;

type Stat = { bookings: number; items: number; spend: string | null };

function progress(space: TravelSpace) {
  if (!space.start_date || !space.end_date) return null;
  const start = new Date(`${space.start_date}T00:00:00`).getTime();
  const end = new Date(`${space.end_date}T00:00:00`).getTime();
  if (end <= start) return null;
  return Math.max(0, Math.min(1, (Date.now() - start) / (end - start)));
}

export default function TripsScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [archived, setArchived] = useState<TravelSpace[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number]>('all');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<Record<string, Stat>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    // Only offer to connect Gmail until at least one inbox is connected.
    loadGmail(token)
      .then((gmail) => setGmailConnected(gmail.status === 'connected'))
      .catch(() => undefined);
    try {
      const [live, old] = await loadCached(`trips:${token}`, () =>
        Promise.all([
          api<TravelSpace[]>('/travel-spaces', { token }),
          api<TravelSpace[]>('/travel-spaces?archived=true', { token }),
        ]),
      );
      setSpaces(live);
      setArchived(old);
      const now = new Date();
      const rows = await Promise.all(
        live.map(async (space) => {
          const [saved, plan, summary] = await Promise.all([
            api<Booking[]>(`/bookings?travel_space_id=${space.id}`, { token }),
            api<{ items: { id: string }[] }>(`/itinerary?view=chronological&travel_space_id=${space.id}`, { token }),
            api<{ currencies: { currency: string; combined: string }[] }>(
              `/living/summary?travel_space_id=${space.id}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
              { token },
            ),
          ]);
          const money = summary.currencies.filter((row) => Number(row.combined) !== 0);
          return [
            space.id,
            {
              bookings: saved.filter((booking) => booking.status !== 'cancelled').length,
              items: plan.items?.length ?? 0,
              spend: money.length ? money.map((row) => `${row.currency} ${row.combined}`).join(' · ') : null,
            },
          ] as const;
        }),
      );
      setStats(Object.fromEntries(rows));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load trips.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
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
        <PressableScale style={styles.add} onPress={() => router.push('/new-space')}>
          <Text style={styles.addLabel}>+</Text>
        </PressableScale>
      </View>
      <View style={styles.filters}>
        {filters.map((item) => (
          <PressableScale key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterOn]}>
            <Text style={[styles.filterText, filter === item && styles.filterTextOn]}>{filterLabels[item]}</Text>
          </PressableScale>
        ))}
      </View>
      {gmailConnected === false ? <Button label="Connect Gmail" tone="quiet" onPress={() => router.push('/gmail')} /> : null}
      {error ? <Muted>{error}</Muted> : null}
      {!loaded ? <SkeletonList /> : null}
      {loaded
        ? visible.map((space, index) => {
            const featured = space.status === 'active';
            return (
              <Appear key={space.id} index={index}>
                <PressableScale onPress={() => router.push(`/spaces/${space.id}`)} style={[styles.card, featured && styles.featured]}>
                  <View style={styles.row}>
                    <Text style={[styles.badge, featured && styles.badgeOn]}>{space.status}</Text>
                    <Text style={[styles.meta, featured && styles.onDark]}>{space.start_date ? prettyDate(space.start_date) : 'No dates yet'}</Text>
                  </View>
                  <SharedTitle tag={`space-${space.id}`} style={[styles.cardTitle, featured && styles.onDark]}>
                    {space.title}
                  </SharedTitle>
                  <Text style={[styles.meta, featured && styles.onDark]}>
                    {[space.destination_name, space.start_date && space.end_date ? `${prettyDay(space.start_date)} → ${prettyDay(space.end_date)}` : null, space.kind.replaceAll('_', ' ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {featured && progress(space) !== null ? (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${(progress(space) ?? 0) * 100}%` }]} />
                    </View>
                  ) : null}
                  {stats[space.id] ? (
                    <Text style={[styles.meta, featured && styles.onDark]}>
                      {stats[space.id].bookings} bookings · {stats[space.id].items} itinerary items
                      {stats[space.id].spend ? ` · ${stats[space.id].spend} this month` : ''}
                    </Text>
                  ) : null}
                  {space.status === 'archived' ? (
                    <PressableScale onPress={() => restore(space)} style={styles.restore}>
                      <Text style={styles.restoreLabel}>Restore to active</Text>
                    </PressableScale>
                  ) : null}
                </PressableScale>
              </Appear>
            );
          })
        : null}
      {visible.length === 0 ? (
        <Muted>{filter === 'archived' ? 'Nothing is archived.' : 'No trips in this view.'}</Muted>
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
  track: { height: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 8 },
  fill: { height: 6, borderRadius: 99, backgroundColor: '#fff' },
});
