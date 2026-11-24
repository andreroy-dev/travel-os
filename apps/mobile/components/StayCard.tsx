import { StyleSheet, Text, View } from 'react-native';

import { Muted, theme } from '@/components/ui';
import type { Booking } from '@/lib/types';

function line(label: string, value: string | null | undefined) {
  if (!value || !value.trim()) return null;
  return (
    <View key={label} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/** Stay card built only from fields that were on the confirmation. */
export function StayCard({ booking }: { booking: Booking }) {
  const details = booking.details ?? {};
  const price =
    booking.price_amount != null
      ? `${booking.price_currency ? `${booking.price_currency} ` : ''}${booking.price_amount}`
      : null;
  const when = [booking.starts_at?.slice(0, 10), booking.ends_at?.slice(0, 10)].filter(Boolean).join(' → ');
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{String(details.property_name || booking.location_label || booking.provider)}</Text>
      <Muted>{[booking.provider, details.stay_kind ? String(details.stay_kind) : null].filter(Boolean).join(' · ')}</Muted>
      {when ? <Text style={styles.when}>{when}</Text> : null}
      {line('Address', details.address == null ? null : String(details.address))}
      {line('Room', details.room == null ? null : String(details.room))}
      {line('Guests', details.guests == null ? null : String(details.guests))}
      {line('PIN', details.reservation_pin == null ? null : String(details.reservation_pin))}
      {line('Check-in', details.check_in_time == null ? null : String(details.check_in_time))}
      {line('Check-out', details.check_out_time == null ? null : String(details.check_out_time))}
      {line('Price', price)}
      {line('Confirmation', booking.confirmation_reference)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 16, gap: 8, borderWidth: 1, borderColor: theme.line },
  name: { color: theme.ink, fontSize: 24, fontWeight: '700' },
  when: { color: theme.moss, fontWeight: '700' },
  row: { gap: 2 },
  label: { color: theme.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: theme.ink, fontSize: 16 },
});
