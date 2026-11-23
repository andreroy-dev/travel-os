import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { addDays, nightsBetween, prettyDay } from '@/lib/dates';
import { useSession } from '@/lib/session';

const kinds = [
  { key: 'friend', label: 'With a friend', placeholder: 'e.g. Anna in Vienna' },
  { key: 'family', label: 'With family', placeholder: 'e.g. Aunt Maria' },
  { key: 'own_place', label: 'My own place', placeholder: 'e.g. My flat in Munich' },
  { key: 'other', label: 'Somewhere else', placeholder: 'e.g. Camping, night bus, couchsurfing' },
] as const;

/**
 * Opened from a "no place to stay" gap on a Travel Space. Records where the
 * traveller is sleeping when it is not a booking, so the gap stops showing and
 * the stay appears on the itinerary.
 */
export default function AddStayScreen() {
  const params = useLocalSearchParams<{ spaceId: string; start: string; end: string }>();
  const { token } = useSession();
  const router = useRouter();
  const gapStart = params.start ?? '';
  const gapEnd = params.end ?? '';
  const [kind, setKind] = useState<(typeof kinds)[number]['key']>('friend');
  const [name, setName] = useState('');
  const [start, setStart] = useState(gapStart);
  const [end, setEnd] = useState(gapEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = kinds.find((item) => item.key === kind) ?? kinds[0];
  const nights = start && end ? nightsBetween(start, end) : 0;

  function shift(which: 'start' | 'end', by: number) {
    if (which === 'start') {
      const next = addDays(start, by);
      if (next >= end) return;
      setStart(next);
    } else {
      const next = addDays(end, by);
      if (next <= start) return;
      setEnd(next);
    }
  }

  async function save() {
    if (!token || !params.spaceId) return;
    const title = name.trim() || chosen.label;
    setBusy(true);
    setError(null);
    try {
      await api('/stays', {
        method: 'POST',
        token,
        body: {
          travel_space_id: params.spaceId,
          title,
          accommodation_type: kind,
          start_date: start,
          end_date: end,
        },
      });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this stay.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>
          {nightsBetween(gapStart, gapEnd)} {nightsBetween(gapStart, gapEnd) === 1 ? 'night' : 'nights'} without a booking
        </Text>
        <Muted>
          {prettyDay(gapStart)} → {prettyDay(gapEnd)}. Tell us where you'll be and we'll add it to your itinerary.
        </Muted>
      </View>

      <Text style={styles.label}>Where are you staying?</Text>
      <View style={styles.kinds}>
        {kinds.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setKind(item.key)}
            style={[styles.kind, kind === item.key && styles.kindOn]}>
            <Text style={[styles.kindLabel, kind === item.key && styles.kindLabelOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <Field label="Name or place" value={name} onChangeText={setName} placeholder={chosen.placeholder} />

      <View style={styles.row}>
        <DateStepper label="From" value={start} onMinus={() => shift('start', -1)} onPlus={() => shift('start', 1)} />
        <DateStepper label="Until" value={end} onMinus={() => shift('end', -1)} onPlus={() => shift('end', 1)} />
      </View>
      <Muted>
        {nights} {nights === 1 ? 'night' : 'nights'}
      </Muted>

      <ErrorNote message={error} />
      <Button label="Add to itinerary" onPress={save} busy={busy} />
      <Button label="Find a place to book instead" tone="quiet" onPress={() => router.replace('/discover')} />
    </Screen>
  );
}

function DateStepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable onPress={onMinus} style={styles.step} accessibilityLabel={`${label} one day earlier`}>
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{prettyDay(value)}</Text>
        <Pressable onPress={onPlus} style={styles.step} accessibilityLabel={`${label} one day later`}>
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: theme.coralSoft, borderRadius: 18, padding: 16, gap: 4 },
  bannerTitle: { color: theme.ink, fontSize: 18, fontWeight: '700' },
  label: { color: theme.muted, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: theme.line },
  kindOn: { backgroundColor: theme.moss, borderColor: theme.moss },
  kindLabel: { color: theme.ink, fontWeight: '600' },
  kindLabelOn: { color: '#fff' },
  row: { flexDirection: 'row', gap: 12 },
  stepper: { flex: 1, gap: 6 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: theme.line },
  step: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: theme.moss, fontSize: 22, fontWeight: '700' },
  stepValue: { flex: 1, textAlign: 'center', color: theme.ink, fontWeight: '600' },
});
