import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DateField, isoDate } from '@/components/DateField';
import { Button, ErrorNote, Field, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Booking, TravelSpace } from '@/lib/types';

const categories = [
  'flight',
  'accommodation',
  'activity',
  'restaurant',
  'car_rental',
  'train',
  'bus',
  'transfer',
  'cruise',
  'insurance',
  'other',
] as const;
const currencies = ['USD', 'EUR', 'GBP', 'INR', 'AUD'] as const;
const statuses = ['confirmed', 'modified', 'planned', 'completed', 'cancelled'] as const;

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** New date, same time of day as before (so check-in at 15:00 stays 15:00). */
function withDate(date: Date | null, original: string | null): string | null {
  if (!date) return null;
  const suffix = original && original.length > 10 ? original.slice(10) : 'T12:00:00';
  return `${isoDate(date)}${suffix}`;
}

export default function NewBookingScreen() {
  const { token } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ space?: string; id?: string }>();
  const editing = Boolean(params.id);
  const [original, setOriginal] = useState<Booking | null>(null);
  const [status, setStatus] = useState<(typeof statuses)[number]>('confirmed');
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [spaceId, setSpaceId] = useState(params.space ?? '');
  const [category, setCategory] = useState<(typeof categories)[number]>('flight');
  const [provider, setProvider] = useState('');
  const [reference, setReference] = useState('');
  const [location, setLocation] = useState('');
  const [starts, setStarts] = useState<Date | null>(null);
  const [ends, setEnds] = useState<Date | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<(typeof currencies)[number]>('USD');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<TravelSpace[]>('/travel-spaces', { token }).then(setSpaces).catch(() => setSpaces([]));
    if (!params.id) return;
    api<Booking>(`/bookings/${params.id}`, { token })
      .then((booking) => {
        setOriginal(booking);
        setSpaceId(booking.travel_space_id ?? '');
        setCategory(booking.category as (typeof categories)[number]);
        setProvider(booking.provider);
        setReference(booking.confirmation_reference ?? '');
        setLocation(booking.location_label ?? '');
        setStarts(toDate(booking.starts_at));
        setEnds(toDate(booking.ends_at));
        setAmount(booking.price_amount ?? '');
        if (booking.price_currency && (currencies as readonly string[]).includes(booking.price_currency)) {
          setCurrency(booking.price_currency as (typeof currencies)[number]);
        }
        setStatus(booking.status as (typeof statuses)[number]);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this booking.'));
  }, [token, params.id]);

  async function save() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (editing && original) {
        await api(`/bookings/${original.id}`, {
          method: 'PATCH',
          token,
          body: {
            travel_space_id: spaceId || null,
            category,
            provider,
            confirmation_reference: reference.trim() || null,
            location_label: location.trim() || null,
            starts_at: withDate(starts, original.starts_at),
            ends_at: withDate(ends, original.ends_at),
            price_amount: amount.trim() || null,
            price_currency: amount.trim()
              ? original.price_currency && !(currencies as readonly string[]).includes(original.price_currency)
                ? original.price_currency
                : currency
              : null,
            status,
          },
        });
        router.back();
        return;
      }
      await api('/bookings', {
        token,
        body: {
          travel_space_id: spaceId || null,
          category,
          provider,
          confirmation_reference: reference.trim() || null,
          location_label: location.trim() || null,
          starts_at: starts ? `${isoDate(starts)}T12:00:00` : null,
          ends_at: ends ? `${isoDate(ends)}T12:00:00` : null,
          price_amount: amount.trim() || null,
          price_currency: amount.trim() ? currency : null,
          status: 'confirmed',
        },
      });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the booking.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: editing ? 'Edit booking' : 'Add booking' }} />
      <Field label="Provider" value={provider} onChangeText={setProvider} placeholder="Airline, hotel, or operator" />
      <Field label="Confirmation" value={reference} onChangeText={setReference} placeholder="ABC123" />
      <Field label="Location" value={location} onChangeText={setLocation} placeholder="LIS → CDG" />
      <DateField label="Starts" value={starts} onChange={setStarts} placeholder="Choose a start date" />
      <DateField label="Ends" value={ends} onChange={setEnds} placeholder="Choose an end date" />
      <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="240" />
      <Text style={styles.label}>Currency</Text>
      <View style={styles.pills}>
        {currencies.map((option) => (
          <Pressable key={option} onPress={() => setCurrency(option)} style={[styles.pill, currency === option && styles.pillOn]}>
            <Text style={[styles.pillText, currency === option && styles.pillTextOn]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Category</Text>
      <View style={styles.pills}>
        {categories.map((option) => (
          <Pressable key={option} onPress={() => setCategory(option)} style={[styles.pill, category === option && styles.pillOn]}>
            <Text style={[styles.pillText, category === option && styles.pillTextOn]}>{option.replaceAll('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>
      {editing ? (
        <>
          <Text style={styles.label}>Status</Text>
          <View style={styles.pills}>
            {statuses.map((option) => (
              <Pressable key={option} onPress={() => setStatus(option)} style={[styles.pill, status === option && styles.pillOn]}>
                <Text style={[styles.pillText, status === option && styles.pillTextOn]}>{option}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.label}>Travel space</Text>
      <View style={styles.pills}>
        <Pressable onPress={() => setSpaceId('')} style={[styles.pill, spaceId === '' && styles.pillOn]}>
          <Text style={[styles.pillText, spaceId === '' && styles.pillTextOn]}>Unassigned</Text>
        </Pressable>
        {spaces.map((space) => (
          <Pressable key={space.id} onPress={() => setSpaceId(space.id)} style={[styles.pill, spaceId === space.id && styles.pillOn]}>
            <Text style={[styles.pillText, spaceId === space.id && styles.pillTextOn]}>{space.title}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorNote message={error} />
      <Button label={editing ? 'Save changes' : 'Save booking'} onPress={save} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.muted, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pillOn: { backgroundColor: theme.moss, borderColor: theme.moss },
  pillText: { color: theme.ink, fontWeight: '600', textTransform: 'capitalize' },
  pillTextOn: { color: '#fff' },
});
