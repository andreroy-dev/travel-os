import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChoicePicker } from '@/components/Pickers';
import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { addDays, prettyDay, weekday } from '@/lib/dates';
import { success } from '@/lib/haptics';
import type { SavedPlace } from '@/lib/types';

const categories = ['restaurant', 'cafe', 'sight', 'museum', 'shop', 'nightlife', 'nature', 'place'] as const;
const statuses = ['saved', 'considering', 'visited'] as const;

/** Saved places for one Travel Space: add, mark visited, remove. */
export function SpacePlaces({
  spaceId,
  token,
  start,
  end,
}: {
  spaceId: string;
  token: string;
  start?: string | null;
  end?: string | null;
}) {
  const [planning, setPlanning] = useState<SavedPlace | null>(null);
  const [planDay, setPlanDay] = useState<string>(start ?? new Date().toISOString().slice(0, 10));
  const [planned, setPlanned] = useState<string | null>(null);

  function shiftDay(by: number) {
    const next = addDays(planDay, by);
    if ((start && next < start) || (end && next > end)) return;
    setPlanDay(next);
  }

  async function plan() {
    if (!planning) return;
    try {
      await api('/itinerary/plans', {
        method: 'POST',
        token,
        body: { travel_space_id: spaceId, title: planning.name, starts_on: planDay, location_label: planning.address },
      });
      success();
      setPlanned(`${planning.name} is on ${weekday(planDay)} ${prettyDay(planDay)}.`);
      setPlanning(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add it to the itinerary.');
    }
  }

  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<(typeof categories)[number]>('place');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await api<SavedPlace[]>(`/saved-places?travel_space_id=${spaceId}`, { token });
      setPlaces(all.filter((place) => place.travel_space_id === spaceId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load places.');
    }
  }, [spaceId, token]);

  useEffect(() => void load(), [load]);

  async function add() {
    if (!name.trim()) {
      setError('Give the place a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/saved-places', {
        method: 'POST',
        token,
        body: { travel_space_id: spaceId, name: name.trim(), address: address.trim() || null, notes: notes.trim() || null, category },
      });
      setName('');
      setAddress('');
      setNotes('');
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this place.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(place: SavedPlace, status: (typeof statuses)[number]) {
    try {
      await api(`/saved-places/${place.id}`, { method: 'PATCH', token, body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this place.');
    }
  }

  async function remove(place: SavedPlace) {
    const ok = await confirmAction('Remove this place?', `"${place.name}" will be removed from this space.`, 'Remove');
    if (!ok) return;
    try {
      await api(`/saved-places/${place.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this place.');
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <ErrorNote message={error} />
      {places.length === 0 && !adding ? (
        <View style={styles.card}>
          <Text style={styles.title}>No saved places yet</Text>
          <Muted>Keep restaurants, sights and spots you want to visit on this trip.</Muted>
        </View>
      ) : null}
      {places.map((place) => (
        <View key={place.id} style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{place.name}</Text>
              <Muted>{[place.category, place.address].filter(Boolean).join(' · ')}</Muted>
              {place.notes ? <Muted>{place.notes}</Muted> : null}
            </View>
            <Pressable onPress={() => remove(place)} hitSlop={8}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
          <View style={styles.pills}>
            {statuses.map((status) => (
              <Pressable key={status} onPress={() => setStatus(place, status)} style={[styles.pill, place.status === status && styles.pillOn]}>
                <Text style={[styles.pillText, place.status === status && styles.pillTextOn]}>{status}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setPlanned(null);
                setPlanDay(start && new Date().toISOString().slice(0, 10) < start ? start : new Date().toISOString().slice(0, 10));
                setPlanning(place);
              }}
              style={[styles.pill, styles.planPill]}>
              <Text style={[styles.pillText, { color: '#fff' }]}>Plan a day</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {planned ? <Muted>{planned} You'll find it on the itinerary.</Muted> : null}
      <Sheet visible={planning !== null} title={planning ? `Plan ${planning.name}` : 'Plan'} onClose={() => setPlanning(null)}>
        <Muted>Adds it to that day's itinerary as a plan, not a booking.</Muted>
        <View style={styles.stepper}>
          <Pressable onPress={() => shiftDay(-1)} style={styles.step}>
            <Text style={styles.stepLabel}>−</Text>
          </Pressable>
          <Text style={styles.stepValue}>
            {weekday(planDay)} {prettyDay(planDay)}
          </Text>
          <Pressable onPress={() => shiftDay(1)} style={styles.step}>
            <Text style={styles.stepLabel}>+</Text>
          </Pressable>
        </View>
        <Button label="Add to itinerary" onPress={plan} />
      </Sheet>
      <Button label="Save a place" tone="quiet" onPress={() => setAdding(true)} />
      <Sheet visible={adding} title="Save a place" onClose={() => setAdding(false)}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="A café, a museum" />
        <Field label="Address" value={address} onChangeText={setAddress} placeholder="Optional" />
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" />
        <ChoicePicker
          label="Kind"
          value={category}
          options={categories.map((item) => ({ value: item, label: item }))}
          onChange={(value) => setCategory(value as (typeof categories)[number])}
        />
        <Button label="Save place" onPress={add} busy={busy} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  planPill: { backgroundColor: theme.clay },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: theme.line },
  step: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: theme.moss, fontSize: 22, fontWeight: '700' },
  stepValue: { flex: 1, textAlign: 'center', color: theme.ink, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  title: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  remove: { color: theme.danger, fontWeight: '600' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { backgroundColor: theme.paper, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillOn: { backgroundColor: theme.moss },
  pillText: { color: theme.ink, fontWeight: '600', textTransform: 'capitalize', fontSize: 13 },
  pillTextOn: { color: '#fff' },
});
