import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Appear, PressableScale, SkeletonList } from '@/components/motion';
import { Button, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { FlightCard } from '@/components/FlightCard';
import { StayCard } from '@/components/StayCard';
import { ApiError, api } from '@/lib/api';
import { categoryFields, categoryLabels } from '@/lib/bookingFields';
import { useSession } from '@/lib/session';
import type { BookingDetail } from '@/lib/types';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-');
  const monthIndex = Number(month) - 1;
  if (!year || !day || monthIndex < 0 || monthIndex > 11) return value.slice(0, 10);
  const time = value.length >= 16 ? value.slice(11, 16) : '';
  const clock = time && time !== '00:00' ? ` ${time}` : '';
  return `${Number(day)} ${months[monthIndex]} ${year}${clock}`;
}

function fact(label: string, value: string | null | undefined) {
  if (!value || !value.trim()) return null;
  return { label, value };
}

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!token || !booking) return;
    const ok = await confirmAction(
      'Delete this booking?',
      booking.source === 'gmail'
        ? 'It will be removed from your itinerary. This does not cancel it with the provider, and the next Gmail sync will import it again. To keep it out, edit it and set the status to Cancelled instead.'
        : 'It will be removed from Travel OS and your itinerary. This does not cancel it with the provider and cannot be undone.',
      'Delete',
    );
    if (!ok) return;
    try {
      await api(`/bookings/${booking.id}`, { method: 'DELETE', token });
      if (router.canGoBack()) router.back();
      else router.replace('/trips');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this booking.');
    }
  }

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setBooking(await api<BookingDetail>(`/bookings/${id}`, { token }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this booking.');
    } finally {
      setLoaded(true);
    }
  }, [token, id]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const details = booking?.details ?? {};
  const segments = Array.isArray(details.segments) ? details.segments : [];
  const fields = categoryFields[booking?.category ?? 'other'] ?? categoryFields.other;
  const rows = (
    booking
      ? [
          fact('Provider', booking.provider),
          fact('Confirmation', booking.confirmation_reference),
          fact('Status', booking.status),
          fact('Starts', prettyDate(booking.starts_at)),
          fact('Ends', prettyDate(booking.ends_at)),
          fact(
            'Price',
            booking.price_amount
              ? `${booking.price_currency ? `${booking.price_currency} ` : ''}${booking.price_amount}`
              : null,
          ),
          fact('Cancellation', booking.cancellation_policy),
          ...fields
            .filter((field) => field.key !== 'title')
            .filter((field) => !(booking.category === 'flight' && segments.length > 0 && field.key !== 'passengers'))
            .map((field) => fact(field.label, details[field.key] == null ? null : String(details[field.key]))),
        ]
      : []
  ).filter((row): row is { label: string; value: string } => row !== null);

  return (
    <Screen>
      <Text style={styles.kicker}>{categoryLabels[booking?.category ?? 'other'] ?? 'Booking'}</Text>
      {booking?.category === 'flight' && segments.length > 0 ? null : booking?.category === 'accommodation' ? null : (
        <Text style={styles.title}>{booking?.location_label || booking?.provider || 'Booking'}</Text>
      )}
      <ErrorNote message={error} />
      {!loaded ? <SkeletonList count={3} /> : null}
      {booking?.category === 'flight' && segments.length > 0 ? <FlightCard booking={booking} segments={segments} /> : null}
      {booking?.category === 'accommodation' ? <StayCard booking={booking} /> : null}
      {booking?.category === 'accommodation'
        ? null
        : rows.map((row, index) => (
        <Appear key={row.label} index={index}>
        <View style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
        </Appear>
      ))}
      {booking && booking.sources.length > 0 ? (
        <View style={styles.source}>
          <Text style={styles.label}>Where this came from</Text>
          {booking.sources.map((source, index) => (
            <View key={`${source.url ?? source.subject}-${index}`} style={{ gap: 6 }}>
              <Text style={styles.value}>{source.subject || 'Confirmation email'}</Text>
              <Muted>
                {[source.kind === 'gmail' ? 'Imported from Gmail' : 'Imported email', source.received_at ? prettyDate(source.received_at) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
              {source.url ? (
                <PressableScale onPress={() => source.url && Linking.openURL(source.url)} style={styles.link}>
                  <Text style={styles.linkLabel}>Open original email ↗</Text>
                </PressableScale>
              ) : null}
            </View>
          ))}
        </View>
      ) : booking ? (
        <Muted>{booking.source === 'manual' ? 'Added by you.' : `Source: ${booking.source}`}</Muted>
      ) : null}
      {booking ? (
        <View style={styles.actions}>
          <Button label="Edit, change status or move" onPress={() => router.push({ pathname: '/new-booking', params: { id: booking.id } })} />
          <Button label="Delete booking" tone="quiet" onPress={remove} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: { color: theme.moss, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { color: theme.ink, fontSize: 28, fontWeight: '700' },
  row: { backgroundColor: '#fff', borderRadius: 16, padding: 14, gap: 4 },
  label: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  value: { color: theme.ink, fontSize: 16 },
  actions: { gap: 8, marginTop: 8 },
  source: { backgroundColor: '#fff', borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: theme.line },
  link: { alignSelf: 'flex-start', backgroundColor: theme.mossSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  linkLabel: { color: theme.moss, fontWeight: '700' },
});
