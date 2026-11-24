import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform } from 'react-native';

import { ApiError, api } from '@/lib/api';

/**
 * Trip photos come straight from the phone's gallery (PRD 7.1, product decision 24 Nov):
 * from the day before a trip starts until the day after it ends, every photo taken is
 * added to that trip with its date and place. The image itself stays in the gallery;
 * only the reference, date, coordinates and place name are saved.
 */

export type SyncSpace = { id: string; start_date: string | null; end_date: string | null };
export type SyncResult = { status: 'synced' | 'needs_permission' | 'outside_trip' | 'unavailable'; added: number; scanned: number };

const URI_KEY = 'memory-asset-uris';
const LAST_KEY = (spaceId: string) => `photo-sync:${spaceId}`;
const AUTO_EVERY_MS = 30 * 60 * 1000;
const MAX_PER_RUN = 400;

function dayStart(iso: string, shiftDays: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + shiftDays, 0, 0, 0).getTime();
}

function localDate(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The window photos are collected for: the day before the trip until the end of the day after it. */
export function syncWindow(space: SyncSpace): { from: number; to: number } | null {
  if (!space.start_date) return null;
  const from = dayStart(space.start_date, -1);
  const to = Math.min(Date.now(), space.end_date ? dayStart(space.end_date, 2) : Date.now());
  return from < to ? { from, to } : null;
}

export async function galleryPermission(ask: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await MediaLibrary.getPermissionsAsync(false, ['photo']);
  if (current.granted) return true;
  if (!ask || !current.canAskAgain) return false;
  return (await MediaLibrary.requestPermissionsAsync(false, ['photo'])).granted;
}

export async function assetUris(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(URI_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

async function placeName(latitude: number, longitude: number, cache: Map<string, string | null>) {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let name: string | null = null;
  try {
    // Android needs location permission to look up place names; never prompt for it here.
    if (Platform.OS === 'android' && !(await Location.getForegroundPermissionsAsync()).granted) {
      cache.set(key, null);
      return null;
    }
    const [hit] = await Location.reverseGeocodeAsync({ latitude, longitude });
    name = hit ? [hit.district ?? hit.subregion, hit.city ?? hit.region].filter(Boolean).join(', ') || hit.country || null : null;
  } catch {
    name = null;
  }
  cache.set(key, name);
  return name;
}

/**
 * Add new gallery photos from the trip window. `interactive` may show the permission prompt;
 * automatic runs never do and are throttled to once every 30 minutes.
 */
export async function syncTripPhotos(token: string, space: SyncSpace, interactive = false): Promise<SyncResult> {
  if (Platform.OS === 'web') return { status: 'unavailable', added: 0, scanned: 0 };
  const window = syncWindow(space);
  if (!window) return { status: 'outside_trip', added: 0, scanned: 0 };
  if (!(await galleryPermission(interactive))) return { status: 'needs_permission', added: 0, scanned: 0 };
  if (!interactive) {
    const last = Number((await AsyncStorage.getItem(LAST_KEY(space.id)).catch(() => null)) ?? 0);
    if (Date.now() - last < AUTO_EVERY_MS) return { status: 'synced', added: 0, scanned: 0 };
  }

  const saved = await api<{ photos: { asset_key: string }[] }>(`/memories?travel_space_id=${space.id}`, { token });
  const known = new Set(saved.photos.map((photo) => photo.asset_key));
  const uris = await assetUris();
  const places = new Map<string, string | null>();
  let after: string | undefined;
  let scanned = 0;
  let added = 0;

  while (scanned < MAX_PER_RUN) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.photo,
      createdAfter: window.from,
      createdBefore: window.to,
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      first: 50,
      after,
    });
    for (const asset of page.assets) {
      scanned += 1;
      uris[asset.id] = asset.uri;
      if (known.has(asset.id)) continue;
      const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false }).catch(() => null);
      const spot = info?.location ?? null;
      const label = spot ? await placeName(spot.latitude, spot.longitude, places) : null;
      try {
        await api('/memories/photos', {
          token,
          body: {
            travel_space_id: space.id,
            asset_key: asset.id,
            filename: asset.filename || 'photo.jpg',
            taken_on: localDate(asset.creationTime),
            latitude: spot?.latitude ?? null,
            longitude: spot?.longitude ?? null,
            place_label: label,
          },
        });
        known.add(asset.id);
        added += 1;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
      }
    }
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
  await AsyncStorage.setItem(URI_KEY, JSON.stringify(uris)).catch(() => undefined);
  await AsyncStorage.setItem(LAST_KEY(space.id), String(Date.now())).catch(() => undefined);
  return { status: 'synced', added, scanned };
}
