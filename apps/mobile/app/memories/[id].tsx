import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Appear, PressableScale } from '@/components/motion';
import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { prettyDay, weekday } from '@/lib/dates';
import { success, tap } from '@/lib/haptics';
import { assetUris, galleryPermission, syncTripPhotos, syncWindow } from '@/lib/photoSync';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

type Photo = {
  id: string;
  asset_key: string;
  filename: string;
  taken_on: string | null;
  latitude: number | null;
  longitude: number | null;
  place_label: string | null;
  caption: string | null;
  album: string | null;
};
type Note = { id: string; on_date: string; body: string };
type Bundle = { photos: Photo[]; notes: Note[]; located: Photo[] };

const legacyFilesKey = 'memory-files';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function group(photos: Photo[], by: 'place' | 'day') {
  const map = new Map<string, Photo[]>();
  for (const photo of photos) {
    const key = by === 'place' ? photo.place_label || 'Place not recorded' : photo.taken_on || 'Date not recorded';
    map.set(key, [...(map.get(key) ?? []), photo]);
  }
  const entries = [...map.entries()];
  if (by === 'day') entries.sort(([a], [b]) => a.localeCompare(b));
  else entries.sort(([, a], [, b]) => b.length - a.length);
  return entries;
}

export default function MemoriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [space, setSpace] = useState<TravelSpace | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [uris, setUris] = useState<Record<string, string>>({});
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [view, setView] = useState<'place' | 'day'>('place');
  const [open, setOpen] = useState<Photo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    const [trip, next, gallery, legacy] = await Promise.all([
      api<TravelSpace>(`/travel-spaces/${id}`, { token }),
      api<Bundle>(`/memories?travel_space_id=${id}`, { token }),
      assetUris(),
      AsyncStorage.getItem(legacyFilesKey).catch(() => null),
    ]);
    // Older photos were copied into the app; keep showing them by their saved id.
    const copied = legacy ? (JSON.parse(legacy) as Record<string, string>) : {};
    setSpace(trip);
    setBundle(next);
    setUris({ ...gallery, ...Object.fromEntries(next.photos.filter((p) => copied[p.id]).map((p) => [p.asset_key, copied[p.id]])) });
    setAllowed(await galleryPermission(false));
    return trip;
  }, [id, token]);

  const sync = useCallback(
    async (interactive: boolean, trip?: TravelSpace | null) => {
      const target = trip ?? space;
      if (!token || !target) return;
      setSyncing(interactive);
      setError(null);
      try {
        const result = await syncTripPhotos(token, target, interactive);
        if (result.status === 'needs_permission') {
          setAllowed(false);
          if (interactive) setError('Allow photo access in Settings so Travel OS can add your trip photos.');
          return;
        }
        if (result.status === 'outside_trip' && interactive) {
          setNotice('Photos are collected from the day before the trip starts. Add trip dates to begin.');
          return;
        }
        setAllowed(true);
        if (result.added > 0) {
          success();
          setNotice(`Added ${result.added} ${result.added === 1 ? 'photo' : 'photos'} from your gallery.`);
        } else if (interactive) {
          setNotice('Up to date. No new photos from the trip dates.');
        }
        setBundle(await api<Bundle>(`/memories?travel_space_id=${target.id}`, { token }));
        setUris(await assetUris());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not read your gallery.');
      } finally {
        setSyncing(false);
      }
    },
    [space, token],
  );

  useFocusEffect(
    useCallback(() => {
      load()
        // Automatic, silent sync: only when access was already granted and the trip window has started.
        .then((trip) => (trip ? sync(false, trip) : undefined))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load photos.'));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  async function addNote() {
    if (!token || !id || !note.trim()) return;
    try {
      await api('/memories/notes', { token, body: { travel_space_id: id, on_date: today(), body: note.trim() } });
      setNote('');
      setNoting(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that note.');
    }
  }

  async function removePhoto(photo: Photo) {
    if (!token) return;
    const ok = await confirmAction('Remove from this trip?', 'The photo stays in your gallery. It just won’t be part of this trip.', 'Remove');
    if (!ok) return;
    try {
      await api(`/memories/photos/${photo.id}`, { method: 'DELETE', token });
      setOpen(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that photo.');
    }
  }

  const photos = bundle?.photos ?? [];
  const groups = group(photos, view);
  const placeCount = new Set(photos.map((p) => p.place_label).filter(Boolean)).size;
  const window = space ? syncWindow(space) : null;

  return (
    <Screen onRefresh={() => void sync(true)} refreshing={syncing}>
      <Text style={styles.heading}>Memories</Text>
      <Muted>
        {space?.start_date
          ? `Photos you take from ${prettyDay(space.start_date)} (and the day before) are added automatically. They stay in your gallery.`
          : 'Add trip dates and the photos you take on the trip are added automatically.'}
      </Muted>

      <View style={styles.stats}>
        {[
          [String(photos.length), 'Photos'],
          [String(placeCount), 'Places'],
          [String(new Set(photos.map((p) => p.taken_on).filter(Boolean)).size), 'Days'],
          [String(bundle?.notes.length ?? 0), 'Notes'],
        ].map(([value, label]) => (
          <View key={label} style={styles.stat}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {allowed === false ? (
        <View style={styles.permission}>
          <Text style={styles.title}>Connect your photo gallery</Text>
          <Muted>Travel OS reads the photos taken during this trip and sorts them by place and day. Nothing is uploaded or changed.</Muted>
          <Button label="Allow photo access" onPress={() => void sync(true)} busy={syncing} />
        </View>
      ) : (
        <Button label={syncing ? 'Checking your gallery…' : 'Check gallery for new photos'} tone="quiet" onPress={() => void sync(true)} busy={syncing} />
      )}
      {notice ? <Muted>{notice}</Muted> : null}
      <ErrorNote message={error} />

      {photos.length > 0 ? (
        <View style={styles.segment}>
          {(['place', 'day'] as const).map((value) => (
            <PressableScale
              key={value}
              onPress={() => {
                tap();
                setView(value);
              }}
              style={[styles.segmentItem, view === value && styles.segmentOn]}>
              <Text style={[styles.segmentLabel, view === value && styles.segmentLabelOn]}>{value === 'place' ? 'By place' : 'By day'}</Text>
            </PressableScale>
          ))}
        </View>
      ) : window ? (
        <Muted>No photos from the trip dates yet. New ones appear here as you take them.</Muted>
      ) : null}

      {groups.map(([key, items], index) => (
        <Appear key={key} index={index}>
          <View style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.title}>
                {view === 'day' && /^\d{4}-/.test(key) ? `${weekday(key)} · ${prettyDay(key)}` : key}
              </Text>
              <Muted>{items.length}</Muted>
            </View>
            <View style={styles.grid}>
              {items.map((photo) => (
                <Pressable key={photo.id} onPress={() => setOpen(photo)} style={styles.cell}>
                  {uris[photo.asset_key] ? (
                    <Image source={{ uri: uris[photo.asset_key] }} style={styles.thumb} contentFit="cover" recyclingKey={photo.id} transition={150} />
                  ) : (
                    <View style={[styles.thumb, styles.missing]}>
                      <Text style={styles.missingText}>On another phone</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
            {view === 'day' ? (
              <Muted>{[...new Set(items.map((p) => p.place_label).filter(Boolean))].join(' · ') || 'Places not recorded'}</Muted>
            ) : null}
          </View>
        </Appear>
      ))}

      {photos.some((p) => p.latitude != null) ? (
        <PressableScale onPress={() => router.push(`/map?space=${id}`)} style={styles.mapLink}>
          <Text style={styles.title}>See them on the map</Text>
          <Muted>Every photo with a location, pinned where you took it.</Muted>
        </PressableScale>
      ) : null}

      <Text style={styles.title}>Journal</Text>
      {(bundle?.notes ?? []).map((item) => (
        <View key={item.id} style={styles.note}>
          <Muted>{prettyDay(item.on_date)}</Muted>
          <Text style={styles.body}>{item.body}</Text>
        </View>
      ))}
      <Button label="Write today’s note" tone="quiet" onPress={() => setNoting(true)} />

      <Sheet visible={noting} title="Today’s note" onClose={() => setNoting(false)}>
        <Field label="What happened" value={note} onChangeText={setNote} placeholder="A few lines" multiline />
        <Button label="Save note" onPress={addNote} />
      </Sheet>

      <Modal visible={open !== null} animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={[styles.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.viewerTop}>
            <Pressable onPress={() => setOpen(null)} hitSlop={12}>
              <Text style={styles.viewerClose}>Done</Text>
            </Pressable>
            {open ? (
              <Pressable onPress={() => void removePhoto(open)} hitSlop={12}>
                <Text style={styles.viewerRemove}>Remove from trip</Text>
              </Pressable>
            ) : null}
          </View>
          {open && uris[open.asset_key] ? (
            <Image source={{ uri: uris[open.asset_key] }} style={styles.full} contentFit="contain" transition={150} />
          ) : (
            <View style={styles.full} />
          )}
          {open ? (
            <View style={{ gap: 2, paddingHorizontal: 20 }}>
              <Text style={styles.viewerTitle}>{open.place_label ?? 'Place not recorded'}</Text>
              <Text style={styles.viewerMeta}>{open.taken_on ? `${weekday(open.taken_on)} ${prettyDay(open.taken_on)}` : 'Date not recorded'}</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 32, fontWeight: '800', color: theme.ink, letterSpacing: -0.5 },
  title: { fontSize: 17, fontWeight: '700', color: theme.ink },
  body: { color: theme.ink, fontSize: 16, lineHeight: 22 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.line },
  statValue: { color: theme.ink, fontSize: 20, fontWeight: '800' },
  statLabel: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  permission: { backgroundColor: theme.mossSoft, borderRadius: 20, padding: 16, gap: 8 },
  segment: { flexDirection: 'row', backgroundColor: '#e6ece8', borderRadius: 14, padding: 4 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  segmentOn: { backgroundColor: '#fff' },
  segmentLabel: { color: theme.muted, fontWeight: '600' },
  segmentLabelOn: { color: theme.ink },
  group: { gap: 8 },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -2 },
  cell: { width: '33.333%', padding: 2 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: '#d7e6df' },
  missing: { alignItems: 'center', justifyContent: 'center' },
  missingText: { color: theme.muted, fontSize: 10, textAlign: 'center' },
  mapLink: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 4, borderWidth: 1, borderColor: theme.line },
  note: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4, borderWidth: 1, borderColor: theme.line },
  viewer: { flex: 1, backgroundColor: '#000', gap: 12 },
  viewerTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  viewerClose: { color: '#fff', fontWeight: '700', fontSize: 16 },
  viewerRemove: { color: '#ff9b85', fontWeight: '600', fontSize: 15 },
  full: { flex: 1, width: '100%' },
  viewerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  viewerMeta: { color: '#bbb' },
});
