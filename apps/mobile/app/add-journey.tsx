import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { addDays, prettyDay, weekday } from '@/lib/dates';
import { useSession } from '@/lib/session';

const modes = [
  { key: 'train', label: 'Train' },
  { key: 'bus', label: 'Bus' },
  { key: 'car', label: 'Car' },
  { key: 'flight', label: 'Flight' },
  { key: 'ferry', label: 'Ferry' },
  { key: 'other', label: 'Other' },
] as const;

/**
 * Record how the traveller gets from one place to the next. Opened from a
 * "how are you getting there?" prompt (prefilled) or from the space menu.
 */
export default function AddJourneyScreen() {
  const params = useLocalSearchParams<{ spaceId: string; date?: string; from?: string; to?: string }>();
  const { token } = useSession();
  const router = useRouter();
  const [origin, setOrigin] = useState(params.from ?? '');
  const [destination, setDestination] = useState(params.to ?? '');
  const [mode, setMode] = useState<(typeof modes)[number]['key']>('train');
  const [day, setDay] = useState(params.date ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!token || !params.spaceId) return;
    if (!origin.trim() || !destination.trim()) {
      setError('Add where you are leaving from and where you are going.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/journeys', {
        method: 'POST',
        token,
        body: {
          travel_space_id: params.spaceId,
          origin_label: origin.trim(),
          destination_label: destination.trim(),
          mode,
          depart_on: day,
          arrive_on: day,
          notes: notes.trim() || null,
        },
      });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this journey.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="From" value={origin} onChangeText={setOrigin} placeholder="Vienna" />
      <Field label="To" value={destination} onChangeText={setDestination} placeholder="Salzburg" />
      <Text style={styles.label}>How</Text>
      <View style={styles.pills}>
        {modes.map((item) => (
          <Pressable key={item.key} onPress={() => setMode(item.key)} style={[styles.pill, mode === item.key && styles.pillOn]}>
            <Text style={[styles.pillText, mode === item.key && styles.pillTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Day</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => setDay(addDays(day, -1))} style={styles.step} accessibilityLabel="One day earlier">
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>
          {weekday(day)} {prettyDay(day)}
        </Text>
        <Pressable onPress={() => setDay(addDays(day, 1))} style={styles.step} accessibilityLabel="One day later">
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
      </View>
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="e.g. ÖBB Railjet, ticket on phone" />
      <Muted>This adds it to your itinerary. To store a ticket, add it as a booking instead.</Muted>
      <ErrorNote message={error} />
      <Button label="Add to itinerary" onPress={save} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.muted, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14, paddingVertical: 10 },
  pillOn: { backgroundColor: theme.moss, borderColor: theme.moss },
  pillText: { color: theme.ink, fontWeight: '600' },
  pillTextOn: { color: '#fff' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: theme.line },
  step: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: theme.moss, fontSize: 22, fontWeight: '700' },
  stepValue: { flex: 1, textAlign: 'center', color: theme.ink, fontWeight: '600' },
});
