import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DateField, isoDate } from '@/components/DateField';
import { Button, ErrorNote, Field, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

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

export default function NewBookingScreen() {
  const { token } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ space?: string }>();
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
  }, [token]);

  async function save() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
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
      <Button label="Save booking" onPress={save} busy={busy} />
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
