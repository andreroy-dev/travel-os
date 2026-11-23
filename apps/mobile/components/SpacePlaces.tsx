import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorNote, Field, Muted, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import type { SavedPlace } from '@/lib/types';

const categories = ['restaurant', 'cafe', 'sight', 'museum', 'shop', 'nightlife', 'nature', 'place'] as const;
const statuses = ['saved', 'considering', 'visited'] as const;

/** Saved places for one Travel Space: add, mark visited, remove. */
export function SpacePlaces({ spaceId, token }: { spaceId: string; token: string }) {
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
          </View>
        </View>
      ))}
      {adding ? (
        <View style={styles.card}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Café Central" />
          <Field label="Address (optional)" value={address} onChangeText={setAddress} placeholder="Herrengasse 14, Vienna" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Try the apple strudel" />
          <View style={styles.pills}>
            {categories.map((item) => (
              <Pressable key={item} onPress={() => setCategory(item)} style={[styles.pill, category === item && styles.pillOn]}>
                <Text style={[styles.pillText, category === item && styles.pillTextOn]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <Button label="Save place" onPress={add} busy={busy} />
          <Button label="Cancel" tone="quiet" onPress={() => setAdding(false)} />
        </View>
      ) : (
        <Button label="Save a place" tone="quiet" onPress={() => setAdding(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
