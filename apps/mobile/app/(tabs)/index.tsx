import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { HomeSituation } from '@/components/HomeSituation';
import { Appear, PressableScale, SkeletonList } from '@/components/motion';
import { Muted, Screen, serif, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { loadCached } from '@/lib/cache';
import { scheduleReminderNotes } from '@/lib/notify';
import { syncTripPhotos } from '@/lib/photoSync';
import { categoryNames, currentBooking } from '@/lib/currentBooking';
import { prettyDay } from '@/lib/dates';
import { useSession } from '@/lib/session';
import type { Booking, Dashboard, ItineraryItem } from '@/lib/types';

function ReminderStrip({ token }: { token: string | null }) {
  const [notes, setNotes] = useState<{ kind: string; title: string; body: string }[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      Promise.all([
        api<{ kind: string; title: string; body: string; when: string }[]>('/reminders', { token }),
        api<{ notifications_enabled: boolean }>('/preferences', { token }),
      ])
        .then(([notes, preferences]) => {
          setNotes(notes);
          void scheduleReminderNotes(notes, preferences.notifications_enabled).catch(() => undefined);
        })
        .catch(() => setNotes([]));
    }, [token]),
  );
  if (notes.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {notes.map((note) => (
        <View key={`${note.kind}-${note.body}`} style={styles.reminder}>
          <Text style={styles.planTitle}>{note.title}</Text>
          <Text style={styles.planMeta}>{note.body}</Text>
        </View>
      ))}
    </View>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function localToday() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayLabel(start: string | null, end: string | null) {
  if (!start) return null;
  const today = new Date(`${localToday()}T00:00:00`);
  const startDate = new Date(`${start}T00:00:00`);
  const day = Math.round((today.getTime() - startDate.getTime()) / 86400000) + 1;
  if (day < 1) return null;
  if (!end) return `Day ${day}`;
  const total = Math.round((new Date(`${end}T00:00:00`).getTime() - startDate.getTime()) / 86400000) + 1;
  return `Day ${Math.min(day, Math.max(total, 1))}`;
}

function clock(item: ItineraryItem) {
  const time = item.starts_at?.slice(11, 16);
  return time && time !== '00:00' ? time : '—';
}

function ticketTitle(booking: Booking) {
  const segment = booking.details?.segments?.[0];
  if (segment?.origin_code && segment?.destination_code) {
    return `${segment.origin_code} → ${segment.destination_code}`;
  }
  return booking.location_label ?? booking.provider;
}

export default function HomeScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const next = await loadCached(`home:${token}`, () => api<Dashboard>('/dashboard', { token }));
      if (next.travel_space) {
        // Trip photos flow in from the gallery in the background (throttled, never prompts).
        void syncTripPhotos(token, next.travel_space, false).catch(() => undefined);
      }
      const space = next.travel_space?.id;
      const [plan, saved] = await Promise.all([
        api<{ items: ItineraryItem[] }>(
          `/itinerary?view=chronological${space ? `&travel_space_id=${space}` : ''}`,
          { token },
        ),
        api<Booking[]>(space ? `/bookings?travel_space_id=${space}` : '/bookings', { token }),
      ]);
      setDashboard(next);
      setItems(plan.items ?? []);
      setBookings(saved.filter((booking) => booking.status !== 'cancelled'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load home.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const space = dashboard?.travel_space;
  const place = space?.destination_name ?? space?.title;
  const count = space ? dayLabel(space.start_date, space.end_date) : null;
  const heading = count && place ? `${count} in ${place}` : space?.title ?? 'At home';
  const today = localToday();
  const todayItems = items.filter((item) => item.starts_on === today);
  // Nothing today: show what's coming next, never what already happened.
  const plan = todayItems.length > 0 ? todayItems : items.filter((item) => (item.starts_on ?? '') > today).slice(0, 4);
  // One tile per kind of booking; each shows the one that matters now and opens the full list.
  const order = ['flight', 'accommodation', 'train', 'bus', 'activity', 'car_rental', 'transfer', 'restaurant', 'cruise', 'insurance', 'other'];
  const groups = order
    .map((category) => ({ category, count: bookings.filter((b) => b.category === category).length, current: currentBooking(bookings, category) }))
    .filter((group) => group.count > 0 && group.current);

  return (
    <Screen safeTop onRefresh={load} refreshing={refreshing}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{greeting()}</Text>
          <Text style={styles.heading}>{heading}</Text>
        </View>
        <PressableScale onPress={() => router.push('/(tabs)/profile')} style={styles.bell}>
          <SymbolView name="bell" tintColor={theme.ink} size={18} />
        </PressableScale>
      </View>
      {error ? <Muted>{error}</Muted> : null}
      {!loaded ? <SkeletonList count={4} /> : null}
      {loaded && space ? (
        <View style={styles.pill}>
          <Text style={styles.pillText}>
            {space.status} · {space.title}
          </Text>
        </View>
      ) : loaded ? (
        <View style={styles.emptyCard}>
          <Text style={styles.section}>No trip in progress</Text>
          <Muted>Your next trips and travel history are below.</Muted>
        </View>
      ) : null}

      {loaded && dashboard ? <HomeSituation dashboard={dashboard} /> : null}

      {loaded ? (
        <View style={styles.shortcuts}>
          {(
            [
              ['Map', 'map', space ? `/map?space=${space.id}` : '/map'],
              ['Expenses', 'creditcard', space ? `/expenses?space=${space.id}` : '/expenses'],
              ['Docs', 'doc.text', '/wallet'],
              ['Memories', 'photo', space ? `/memories/${space.id}` : '/(tabs)/trips'],
            ] as const
          ).map(([label, icon, path]) => (
            <PressableScale key={label} onPress={() => router.push(path as '/wallet')} style={styles.shortcut}>
              <SymbolView name={icon} tintColor={theme.moss} size={20} />
              <Text style={styles.shortcutLabel}>{label}</Text>
            </PressableScale>
          ))}
        </View>
      ) : null}

      {loaded ? <View style={styles.rowBetween}>
        <Text style={styles.section}>{todayItems.length > 0 ? "Today's plan" : 'Coming up'}</Text>
        {space ? (
          <PressableScale onPress={() => router.push(`/spaces/${space.id}`)}>
            <Text style={styles.link}>Itinerary</Text>
          </PressableScale>
        ) : null}
      </View> : null}
      {loaded && plan.length === 0 ? <Muted>Nothing is scheduled yet.</Muted> : null}
      {loaded
        ? plan.map((item, index) => (
        <Appear key={item.id} index={index}>
        <View style={styles.planRow}>
          <View style={[styles.bar, item.status === 'confirmed' ? styles.barOn : styles.barOff]} />
          <Text style={styles.time}>{clock(item)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.planTitle}>{item.title}</Text>
            <Text style={styles.planMeta}>
              {item.location_label ? `${item.location_label} · ` : ''}
              {item.status === 'confirmed' ? 'Confirmed booking' : item.status === 'completed' ? 'Done' : 'Planned'}
            </Text>
          </View>
        </View>
        </Appear>
      ))
        : null}

      {loaded ? <Text style={styles.section}>Tickets & bookings</Text> : null}
      <View style={styles.ticketRow}>
        {groups.map(({ category, count, current }, index) => {
          const featured = category === 'flight';
          const names = categoryNames[category] ?? categoryNames.other;
          const booking = current!;
          const when = booking.starts_at ? `${prettyDay(booking.starts_at)}${booking.ends_at && booking.ends_at.slice(0, 10) !== booking.starts_at.slice(0, 10) ? ` → ${prettyDay(booking.ends_at)}` : ''}` : '';
          return (
            <PressableScale
              key={category}
              onPress={() =>
                router.push({ pathname: '/trip-bookings', params: { category, ...(space ? { space: space.id } : {}) } })
              }
              style={[styles.ticket, featured && styles.ticketOn, index > 1 && styles.ticketSmall]}>
              <Text style={[styles.ticketKind, featured && styles.onDark]}>
                {count === 1 ? names.one : `${names.many} · ${count}`}
              </Text>
              <Text style={[styles.planTitle, featured && styles.onDark]} numberOfLines={2}>
                {ticketTitle(booking)}
              </Text>
              <Text style={[styles.planMeta, featured && styles.onDark]} numberOfLines={1}>
                {when || booking.provider}
              </Text>
              <Text style={[styles.ticketMore, featured && styles.onDark]}>{count > 1 ? `See all ${count} ›` : 'Open ›'}</Text>
            </PressableScale>
          );
        })}
      </View>
      {loaded && groups.length === 0 ? (
        <Muted>Confirmed bookings show up here after you add one. A link is not a booking.</Muted>
      ) : null}

      {loaded ? <ReminderStrip token={token} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  kicker: { color: theme.muted, fontSize: 15 },
  heading: { fontFamily: serif, fontSize: 32, color: theme.ink, marginTop: 2 },
  bell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellLabel: { color: theme.ink, fontSize: 18 },
  pill: { alignSelf: 'flex-start', backgroundColor: theme.moss, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pillText: { color: '#fff', textTransform: 'capitalize', fontWeight: '600' },
  emptyCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 6 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink, marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: theme.moss, fontWeight: '700' },
  planRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginTop: 2 },
  barOn: { backgroundColor: theme.moss },
  barOff: { backgroundColor: '#d7e0da' },
  time: { width: 48, color: theme.moss, fontWeight: '700' },
  planTitle: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  planMeta: { color: theme.muted, marginTop: 2 },
  ticketRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ticketSmall: { minHeight: 90 },
  ticketMore: { color: theme.moss, fontWeight: '700', fontSize: 12, marginTop: 4 },
  ticket: { flexBasis: '46%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 4, minHeight: 110 },
  ticketOn: { backgroundColor: theme.mossDeep },
  ticketKind: { color: theme.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  onDark: { color: '#e7f3ee' },
  shortcuts: { flexDirection: 'row', gap: 8 },
  shortcut: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: theme.line,
  },
  shortcutLabel: { color: theme.moss, fontWeight: '700', fontSize: 12 },
  reminder: { backgroundColor: theme.coralSoft, borderRadius: 16, padding: 12, gap: 2 },
});
