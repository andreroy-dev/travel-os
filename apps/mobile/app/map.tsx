import * as Location from 'expo-location';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/motion';
import { type MapPoint, pinColor, TripMap, type TripMapHandle } from '@/components/TripMap';
import { Button, ErrorNote, Muted, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { tap } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

type Unlocated = { id: string; kind: string; title: string; query: string };

const filters = [
  ['all', 'Everything'],
  ['booking', 'Booked'],
  ['place', 'Saved'],
  ['photo', 'Photos'],
] as const;

const kindLabel: Record<string, string> = { booking: 'Booking', place: 'Saved place', photo: 'Photo' };

export default function MapScreen() {
  const { space } = useLocalSearchParams<{ space?: string }>();
  const { token } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const map = useRef<TripMapHandle>(null);
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(space ?? null);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [unlocated, setUnlocated] = useState<Unlocated[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const trips = (await api<TravelSpace[]>('/travel-spaces', { token })).filter((trip) => trip.status !== 'archived');
    setSpaces(trips);
    const chosen = spaceId && trips.some((trip) => trip.id === spaceId) ? spaceId : trips[0]?.id ?? null;
    setSpaceId(chosen);
    const data = await api<{ points: MapPoint[]; unlocated: Unlocated[] }>(
      `/map/points${chosen ? `?travel_space_id=${chosen}` : ''}`,
      { token },
    );
    setPoints(data.points);
    setUnlocated(data.unlocated ?? []);
    setError(null);
  }, [spaceId, token]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the map.'));
    }, [load]),
  );

  /** Look up addresses on the phone and save the coordinates, so every module gets the pin. */
  async function pinAll() {
    if (!token || unlocated.length === 0) return;
    setError(null);
    try {
      if (Platform.OS === 'android') {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          setError('Android needs location access to look up addresses. Nothing else uses it.');
          return;
        }
      }
      let found = 0;
      for (const item of unlocated) {
        setPinning(`Finding ${item.title}…`);
        const result = await Location.geocodeAsync(item.query).catch(() => []);
        const spot = result[0];
        if (!spot) continue;
        const body = { latitude: spot.latitude, longitude: spot.longitude };
        if (item.kind === 'booking') await api(`/bookings/${item.id}`, { method: 'PATCH', token, body });
        else await api(`/saved-places/${item.id}/location`, { method: 'PATCH', token, body });
        found += 1;
      }
      await load();
      const missed = unlocated.length - found;
      if (missed > 0) setError(`${missed} couldn't be found from their address. Edit the address and try again.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not pin those on the map.');
    } finally {
      setPinning(null);
    }
  }

  const visible = points.filter((point) => filter === 'all' || point.kind === filter);
  const current = visible.find((point) => point.id === selected) ?? null;

  function choose(point: MapPoint) {
    tap();
    setSelected(point.id);
    map.current?.focus(point);
  }

  function directions(point: MapPoint) {
    const ll = `${point.latitude},${point.longitude}`;
    void Linking.openURL(
      Platform.OS === 'ios'
        ? `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(point.title)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
    );
  }

  function open(point: MapPoint) {
    if (point.kind === 'booking') router.push({ pathname: '/bookings/[id]', params: { id: point.id } });
    else if (point.kind === 'photo' && spaceId) router.push({ pathname: '/memories/[id]', params: { id: spaceId } });
    else if (spaceId) router.push(`/spaces/${spaceId}`);
  }

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.mapArea}>
        <TripMap ref={map} points={visible} selected={selected} onSelect={(id) => setSelected(id)} />
        <View style={[styles.overlay, { paddingTop: insets.top + 8 }]}>
          <View style={styles.topRow}>
            <PressableScale onPress={() => router.back()} style={styles.round}>
              <Text style={styles.roundLabel}>‹</Text>
            </PressableScale>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {spaces.map((trip) => (
                <PressableScale
                  key={trip.id}
                  onPress={() => {
                    setSelected(null);
                    setSpaceId(trip.id);
                  }}
                  style={[styles.chip, spaceId === trip.id && styles.chipDark]}>
                  <Text style={[styles.chipText, spaceId === trip.id && styles.chipTextOn]}>{trip.title}</Text>
                </PressableScale>
              ))}
            </ScrollView>
          </View>
          <View style={styles.chips}>
            {filters.map(([value, label]) => (
              <PressableScale
                key={value}
                onPress={() => {
                  tap();
                  setFilter(value);
                }}
                style={[styles.chip, filter === value && styles.chipOn]}>
                <Text style={[styles.chipText, filter === value && styles.chipTextOn]}>{label}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={[styles.panelBody, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.handle} />
        <ErrorNote message={error} />
        {current ? (
          <View style={styles.selected}>
            <Text style={[styles.kind, { color: pinColor[current.kind] }]}>{kindLabel[current.kind] ?? current.kind}</Text>
            <Text style={styles.title}>{current.title}</Text>
            <Muted>{current.subtitle}</Muted>
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button label="Directions" onPress={() => directions(current)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Open" tone="quiet" onPress={() => open(current)} />
              </View>
            </View>
          </View>
        ) : null}
        {unlocated.length > 0 ? (
          <View style={styles.pinCard}>
            <Text style={styles.title}>
              {unlocated.length} {unlocated.length === 1 ? 'item isn’t' : 'items aren’t'} on the map yet
            </Text>
            <Muted>{unlocated.slice(0, 3).map((item) => item.title).join(' · ')}{unlocated.length > 3 ? ' …' : ''}</Muted>
            <Button label={pinning ?? 'Pin them from their addresses'} onPress={pinAll} busy={pinning !== null} />
          </View>
        ) : null}
        <Text style={styles.section}>
          {visible.length} {visible.length === 1 ? 'pin' : 'pins'}
        </Text>
        {visible.length === 0 ? <Muted>Nothing with a location in this view yet.</Muted> : null}
        {visible.map((point) => (
          <PressableScale key={point.id} onPress={() => choose(point)} style={[styles.row, selected === point.id && styles.rowOn]}>
            <View style={[styles.dot, { backgroundColor: pinColor[point.kind] ?? theme.moss }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{point.title}</Text>
              <Muted>{point.subtitle}</Muted>
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.paper },
  mapArea: { height: '58%' },
  overlay: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 14, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  roundLabel: { fontSize: 24, color: theme.ink, lineHeight: 26 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  chipOn: { backgroundColor: theme.moss },
  chipDark: { backgroundColor: theme.ink },
  chipText: { color: theme.ink, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  panel: { flex: 1, marginTop: -18, backgroundColor: theme.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  panelBody: { padding: 16, gap: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: 4 },
  selected: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 4 },
  kind: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { color: theme.ink, fontSize: 17, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  pinCard: { backgroundColor: theme.coralSoft, borderRadius: 18, padding: 14, gap: 6 },
  section: { color: theme.muted, fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12 },
  rowOn: { borderWidth: 1.5, borderColor: theme.moss },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowTitle: { color: theme.ink, fontWeight: '600', fontSize: 15 },
});
