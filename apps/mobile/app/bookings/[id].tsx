import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { categoryFields, categoryLabels } from '@/lib/bookingFields';
import { useSession } from '@/lib/session';
import type { Booking } from '@/lib/types';

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
  return { label, value: value && value.trim() ? value : 'Not in this email' };
}

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setBooking(await api<Booking>(`/bookings/${id}`, { token }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this booking.');
    }
  }, [token, id]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const details = booking?.details ?? {};
  const fields = categoryFields[booking?.category ?? 'other'] ?? categoryFields.other;
  const rows = booking
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
          .map((field) => fact(field.label, details[field.key] == null ? null : String(details[field.key]))),
      ]
    : [];

  return (
    <Screen>
      <Text style={styles.kicker}>{categoryLabels[booking?.category ?? 'other'] ?? 'Booking'}</Text>
      <Text style={styles.title}>{booking?.location_label || booking?.provider || 'Booking'}</Text>
      <Muted>Only facts written in the confirmation are filled in. Empty rows were not in the email.</Muted>
      <ErrorNote message={error} />
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={[styles.value, row.value === 'Not in this email' && styles.missing]}>{row.value}</Text>
        </View>
      ))}
      {booking?.notes ? (
        <View style={styles.row}>
          <Text style={styles.label}>Email subject</Text>
          <Text style={styles.value}>{booking.notes}</Text>
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
  missing: { color: theme.muted },
});
