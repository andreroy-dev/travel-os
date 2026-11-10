import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Booking, Dashboard, ItineraryItem } from '@/lib/types';

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
  return item.starts_at?.slice(11, 16) ?? '—';
}

export default function HomeScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const next = await api<Dashboard>('/dashboard', { token });
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
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const space = dashboard?.travel_space;
  const place = space?.destination_name ?? space?.title;
  const count = space ? dayLabel(space.start_date, space.end_date) : null;
  const heading = count && place ? `${count} in ${place}` : space?.title ?? 'At home';
  const today = localToday();
  const todayItems = items.filter((item) => item.starts_on === today);
  const plan = todayItems.length > 0 ? todayItems : items.slice(0, 4);
  const flight = bookings.find((booking) => booking.category === 'flight');
  const stay = bookings.find((booking) => booking.category === 'accommodation');
  const tickets = [flight, stay].filter((booking): booking is Booking => Boolean(booking));
  const shownTickets = tickets.length > 0 ? tickets : bookings.slice(0, 2);

  return (
    <Screen safeTop onRefresh={load} refreshing={refreshing}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Good morning</Text>
          <Text style={styles.heading}>{heading}</Text>
        </View>
        <Pressable onPress={() => router.push('/(tabs)/profile')} style={styles.bell}>
          <Text style={styles.bellLabel}>•</Text>
        </Pressable>
      </View>
      {error ? <Muted>{error}</Muted> : null}
      {space ? (
        <View style={styles.pill}>
          <Text style={styles.pillText}>
            {space.status} · {space.title}
          </Text>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.section}>No active Travel Space</Text>
          <Muted>Create one in Trips. Home only shows dates and bookings you save.</Muted>
        </View>
      )}

      <View style={styles.rowBetween}>
        <Text style={styles.section}>{todayItems.length > 0 ? "Today's plan" : 'Saved plan'}</Text>
        {space ? (
          <Pressable onPress={() => router.push(`/spaces/${space.id}`)}>
            <Text style={styles.link}>Itinerary</Text>
          </Pressable>
        ) : null}
      </View>
      {plan.length === 0 ? <Muted>Nothing is scheduled yet.</Muted> : null}
      {plan.map((item) => (
        <View key={item.id} style={styles.planRow}>
          <View style={[styles.bar, item.status === 'confirmed' ? styles.barOn : styles.barOff]} />
          <Text style={styles.time}>{clock(item)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.planTitle}>{item.title}</Text>
            <Text style={styles.planMeta}>
              {item.location_label ? `${item.location_label} · ` : ''}
              {item.status === 'confirmed' ? 'Confirmed booking' : 'Saved place'}
            </Text>
          </View>
        </View>
      ))}

      <Text style={styles.section}>Tickets & bookings</Text>
      <View style={styles.ticketRow}>
        {shownTickets.map((booking) => {
          const featured = booking.category === 'flight';
          return (
            <View key={booking.id} style={[styles.ticket, featured && styles.ticketOn]}>
              <Text style={[styles.ticketKind, featured && styles.onDark]}>{booking.category}</Text>
              <Text style={[styles.planTitle, featured && styles.onDark]}>{booking.location_label ?? booking.provider}</Text>
              <Text style={[styles.planMeta, featured && styles.onDark]}>
                {booking.provider}
                {booking.confirmation_reference ? ` · ${booking.confirmation_reference}` : ''}
              </Text>
            </View>
          );
        })}
      </View>
      {shownTickets.length === 0 ? (
        <Muted>Confirmed bookings show up here after you add one. A link is not a booking.</Muted>
      ) : null}

      <View style={styles.shortcuts}>
        {['Map', 'Expenses', 'Docs', 'Memories'].map((name) => (
          <Pressable key={name} style={styles.shortcut} onPress={() => router.push({ pathname: '/soon', params: { name } })}>
            <Text style={styles.shortcutLabel}>{name}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  kicker: { color: theme.muted, fontSize: 15 },
  heading: { fontSize: 32, fontWeight: '700', color: theme.ink, marginTop: 2 },
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
  ticketRow: { flexDirection: 'row', gap: 10 },
  ticket: { flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 4, minHeight: 110 },
  ticketOn: { backgroundColor: theme.mossDeep },
  ticketKind: { color: theme.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  onDark: { color: '#e7f3ee' },
  shortcuts: { flexDirection: 'row', gap: 8 },
  shortcut: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutLabel: { color: theme.moss, fontWeight: '700', fontSize: 12 },
});
