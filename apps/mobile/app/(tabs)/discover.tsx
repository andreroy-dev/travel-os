import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { prettyDay } from '@/lib/dates';
import { useSession } from '@/lib/session';
import type { StayCoverage, TravelSpace } from '@/lib/types';

type SavedListing = {
  id: string;
  name: string;
  url: string;
  category: string;
  travel_space_id: string | null;
  notes: string | null;
};

type GapRow = { space: string; spaceId: string; start: string; end: string; nights: number };

export default function DiscoverScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [saved, setSaved] = useState<SavedListing[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [spaces, listings, inventory] = await Promise.all([
        api<TravelSpace[]>('/travel-spaces', { token }),
        api<SavedListing[]>('/saved-listings', { token }),
        api<{ providers: string[]; listings: unknown[] }>('/inventory/search', { token }),
      ]);
      const dated = spaces.filter((space) => space.start_date && space.end_date && space.status !== 'archived');
      const coverage = await Promise.all(
        dated.map((space) => api<StayCoverage>(`/travel-spaces/${space.id}/coverage`, { token })),
      );
      const rows: GapRow[] = [];
      dated.forEach((space, index) => {
        for (const gap of coverage[index].gaps) {
          rows.push({ space: space.title, spaceId: space.id, start: gap.start, end: gap.end, nights: gap.nights });
        }
      });
      setGaps(rows);
      setSaved(listings);
      setProviders(inventory.providers);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Discover.');
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  async function save() {
    if (!token) return;
    setBusy(true);
    try {
      await api('/saved-listings', {
        token,
        body: { name, url, category: category === 'all' ? 'accommodation' : category },
      });
      setName('');
      setUrl('');
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that link.');
    } finally {
      setBusy(false);
    }
  }

  async function openListing(listing: SavedListing) {
    if (!token) return;
    try {
      const opened = await api<{ url: string }>(`/saved-listings/${listing.id}/open`, { method: 'POST', token, body: {} });
      await Linking.openURL(opened.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that link.');
    }
  }

  const filters = [
    ['all', 'All'],
    ['accommodation', 'Stays'],
    ['activity', 'Activities'],
    ['food', 'Food'],
    ['coworking', 'Coworking'],
    ['gym', 'Gyms'],
  ] as const;
  const needle = query.trim().toLowerCase();
  const visible = saved.filter((listing) => {
    const matchesCategory = category === 'all' || listing.category === category;
    const matchesQuery = !needle || listing.name.toLowerCase().includes(needle);
    return matchesCategory && matchesQuery;
  });

  return (
    <Screen safeTop onRefresh={load}>
      <Text style={styles.title}>Discover</Text>
      <Muted>Anything you have saved. Travel and everyday life.</Muted>
      <View style={styles.search}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search saved links"
          placeholderTextColor="#8b978f"
          style={styles.searchInput}
        />
      </View>
      <View style={styles.filters}>
        {filters.map(([value, label]) => (
          <Pressable key={value} onPress={() => setCategory(value)} style={[styles.filter, category === value && styles.filterOn]}>
            <Text style={[styles.filterText, category === value && styles.filterTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorNote message={error} />
      {needle ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Provider search</Text>
          <Muted>
            {providers.length === 0
              ? `No provider feed is connected, so “${query.trim()}” has no listings. Saved links are below.`
              : `Connected: ${providers.join(', ')}`}
          </Muted>
        </View>
      ) : null}
      <Text style={styles.section}>Nights still open</Text>
      {gaps.length === 0 ? <Muted>No open nights in your current spaces.</Muted> : null}
      {gaps.map((gap) => (
        <View key={`${gap.spaceId}-${gap.start}`} style={styles.card}>
          <Text style={styles.cardTitle}>{gap.space}</Text>
          <Muted>
            {gap.nights} {gap.nights === 1 ? 'night' : 'nights'} · {prettyDay(gap.start)} → {prettyDay(gap.end)}
          </Muted>
          <Button label="Open this space" tone="quiet" onPress={() => router.push(`/spaces/${gap.spaceId}`)} />
        </View>
      ))}
      <Text style={styles.section}>Saved by you</Text>
      {visible.length === 0 ? <Muted>No saved links in this view. A link is not a booking and has no verified price.</Muted> : null}
      {visible.map((listing) => (
        <View key={listing.id} style={styles.card}>
          <Text style={styles.cardTitle}>{listing.name}</Text>
          <Muted>{listing.category.replaceAll('_', ' ')} · Opens the provider. Travel OS does not make the booking.</Muted>
          <Button label="Open on provider" tone="quiet" onPress={() => openListing(listing)} />
        </View>
      ))}
      <Button label="Save a link" onPress={() => setAdding(true)} />
      <Sheet visible={adding} title="Save a link" onClose={() => setAdding(false)}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="A place you found" />
        <Field label="Link" value={url} onChangeText={setUrl} placeholder="https://" keyboardType="url" />
        <Muted>This opens the provider later. It is not a booking, and the price is not stored.</Muted>
        <Button label="Save link" onPress={save} busy={busy} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: '700', color: theme.ink },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink, marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6, borderWidth: 1, borderColor: theme.line },
  cardTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  search: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14 },
  searchInput: { height: 48, color: theme.ink, fontSize: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  filterOn: { backgroundColor: theme.moss },
  filterText: { color: theme.ink, fontWeight: '600' },
  filterTextOn: { color: '#fff' },
});
