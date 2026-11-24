import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Appear, PressableScale } from '@/components/motion';
import { ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { categoryNames, currentBooking } from '@/lib/currentBooking';
import { clock, nightsBetween, prettyDay, weekday } from '@/lib/dates';
import { useSession } from '@/lib/session';
import type { Booking } from '@/lib/types';

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every booking of one kind on a trip (all flights, all stays…), in date order. */
export default function TripBookingsScreen() {
  const { space, category = 'flight' } = useLocalSearchParams<{ space?: string; category?: string }>();
  const { token } = useSession();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await api<Booking[]>(space ? `/bookings?travel_space_id=${space}` : '/bookings', { token });
      setBookings(rows.filter((b) => b.category === category).sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? '')));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load bookings.');
    }
  }, [category, space, token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const names = categoryNames[category] ?? categoryNames.other;
  const current = currentBooking(bookings, category);
  const today = localToday();

  return (
    <Screen onRefresh={load}>
      <Stack.Screen options={{ title: names.many }} />
      <Muted>
        {bookings.length} {bookings.length === 1 ? names.one.toLowerCase() : names.many.toLowerCase()} on this trip
      </Muted>
      <ErrorNote message={error} />
      {bookings.map((booking, index) => {
        const segments = booking.details?.segments ?? [];
        const first = segments[0];
        const last = segments[segments.length - 1];
        const past = (booking.ends_at ?? booking.starts_at ?? '').slice(0, 10) < today;
        const isCurrent = current?.id === booking.id;
        const cancelled = booking.status === 'cancelled';
        const title =
          category === 'flight' && first
            ? `${first.origin_code ?? first.origin} → ${last?.destination_code ?? last?.destination}`
            : String(booking.details?.property_name || booking.location_label || booking.provider);
        const nights =
          category === 'accommodation' && booking.starts_at && booking.ends_at
            ? nightsBetween(booking.starts_at.slice(0, 10), booking.ends_at.slice(0, 10))
            : null;
        return (
          <Appear key={booking.id} index={index}>
            <PressableScale
              onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: booking.id } })}
              style={[styles.card, isCurrent && styles.current, (past || cancelled) && styles.dim]}>
              <View style={styles.row}>
                <Text style={styles.date}>
                  {booking.starts_at ? `${weekday(booking.starts_at)} ${prettyDay(booking.starts_at)}` : 'No date'}
                </Text>
                {isCurrent ? <Text style={styles.badge}>{past ? 'Latest' : booking.starts_at && booking.starts_at.slice(0, 10) <= today ? 'Now' : 'Next'}</Text> : null}
                {cancelled ? <Text style={[styles.badge, styles.badgeOff]}>Cancelled</Text> : null}
              </View>
              <Text style={styles.title}>{title}</Text>
              <Muted>
                {category === 'flight' && first
                  ? [
                      segments.map((s) => s.flight_number).filter(Boolean).join(' + '),
                      clock(booking.starts_at) ? `departs ${clock(booking.starts_at)}` : null,
                      segments.length > 1 ? `${segments.length - 1} stop${segments.length > 2 ? 's' : ''}` : 'direct',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : [
                      nights != null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
                      booking.ends_at ? `until ${prettyDay(booking.ends_at)}` : null,
                      booking.provider,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </Muted>
              {booking.confirmation_reference ? <Text style={styles.ref}>Ref {booking.confirmation_reference}</Text> : null}
            </PressableScale>
          </Appear>
        );
      })}
      {bookings.length === 0 && !error ? <Muted>Nothing booked in this category yet.</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 4, borderWidth: 1, borderColor: theme.line },
  current: { borderColor: theme.moss, borderWidth: 2 },
  dim: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  date: { color: theme.moss, fontWeight: '700', fontSize: 13, flex: 1 },
  badge: { backgroundColor: theme.moss, color: '#fff', fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  badgeOff: { backgroundColor: theme.danger },
  title: { color: theme.ink, fontSize: 18, fontWeight: '800' },
  ref: { color: theme.muted, fontSize: 12, fontWeight: '600', marginTop: 2 },
});
