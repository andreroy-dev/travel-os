import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DateField, isoDate } from '@/components/DateField';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api, optionalDate } from '@/lib/api';
import { useSession } from '@/lib/session';
import { categoryLabels } from '@/lib/bookingFields';
import type { Booking, IngestResult, Integration, ItineraryItem, SavedPlace, Stay, TravelSpace } from '@/lib/types';

const tabs = ['Itinerary', 'Bookings', 'Photos', 'Budget', 'Docs'] as const;

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const categoryOrder = ['flight', 'accommodation', 'train', 'bus', 'car_rental', 'transfer', 'activity', 'restaurant', 'cruise', 'insurance', 'other'];

function dates(space: TravelSpace) {
  if (!space.start_date && !space.end_date) return 'Dates not set';
  return [space.start_date, space.end_date ?? 'open-ended'].filter(Boolean).join(' – ');
}

function clockLabel(value: string | null) {
  if (!value || value.length < 16) return '';
  const time = value.slice(11, 16);
  return time === '00:00' ? '' : time;
}

function prettyDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  const monthIndex = Number(month) - 1;
  if (!year || !day || monthIndex < 0 || monthIndex > 11) return value.slice(0, 10);
  return `${Number(day)} ${months[monthIndex]} ${year}`;
}

function bookingRange(booking: Booking) {
  const start = booking.starts_at ? prettyDate(booking.starts_at) : '';
  const end = booking.ends_at ? prettyDate(booking.ends_at) : '';
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end;
}

function groupByDay(items: ItineraryItem[]) {
  const groups = new Map<string, ItineraryItem[]>();
  for (const item of items) {
    const key = item.starts_on || 'unscheduled';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

function groupBookings(bookings: Booking[]) {
  const groups = new Map<string, Booking[]>();
  for (const booking of bookings) {
    groups.set(booking.category, [...(groups.get(booking.category) ?? []), booking]);
  }
  return [...groups.entries()].sort(
    (left, right) => categoryOrder.indexOf(left[0]) - categoryOrder.indexOf(right[0]),
  );
}

export default function SpaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const router = useRouter();
  const [space, setSpace] = useState<TravelSpace | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Itinerary');
  const [day, setDay] = useState<string | null>(null);
  const [stayTitle, setStayTitle] = useState('');
  const [stayStart, setStayStart] = useState('');
  const [stayEnd, setStayEnd] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [mode, setMode] = useState('flight');
  const [depart, setDepart] = useState<Date | null>(null);
  const [arrive, setArrive] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gmail, setGmail] = useState<string>('disconnected');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setRefreshing(true);
    try {
      const [nextSpace, nextStays, nextBookings, nextPlaces, plan, integration] = await Promise.all([
        api<TravelSpace>(`/travel-spaces/${id}`, { token }),
        api<Stay[]>(`/travel-spaces/${id}/stays`, { token }),
        api<Booking[]>(`/bookings?travel_space_id=${id}`, { token }),
        api<SavedPlace[]>(`/saved-places?travel_space_id=${id}`, { token }),
        api<{ items: ItineraryItem[] }>(`/itinerary?view=chronological&travel_space_id=${id}`, { token }),
        api<Integration>('/integrations/gmail', { token }),
      ]);
      setGmail(integration.status);
      setSpace(nextSpace);
      setStays(nextStays);
      setBookings(nextBookings);
      setPlaces(nextPlaces);
      setItems(plan.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this space.');
    } finally {
      setRefreshing(false);
    }
  }, [token, id]);

  useFocusEffect(useCallback(() => void load(), [load]));

  async function syncMail() {
    if (!token || !id) return;
    setSyncing(true);
    setError(null);
    try {
      const results = await api<IngestResult[]>(`/integrations/gmail/sync?travel_space_id=${id}`, {
        method: 'POST',
        token,
        body: {},
      });
      const filed = results.filter((item) => item.status === 'imported' && item.booking_id).length;
      await load();
      if (filed === 0) {
        setError('No bookings from the past year matched these dates.');
      } else {
        setTab('Itinerary');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gmail sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const days = [...new Set(items.map((item) => item.starts_on).filter((value): value is string => Boolean(value)))];
  const visible = items.filter((item) => (day ? item.starts_on === day : true));

  async function addStay() {
    if (!token || !id || !stayTitle.trim()) return;
    try {
      await api('/stays', {
        token,
        body: {
          travel_space_id: id,
          title: stayTitle,
          destination_name: space?.destination_name,
          start_date: optionalDate(stayStart),
          end_date: optionalDate(stayEnd),
        },
      });
      setStayTitle('');
      setStayStart('');
      setStayEnd('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the stay.');
    }
  }

  async function addPlace() {
    if (!token || !id || !placeName.trim()) return;
    try {
      await api('/saved-places', {
        token,
        body: { name: placeName, travel_space_id: id, destination_name: space?.destination_name },
      });
      setPlaceName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the place.');
    }
  }

  async function addJourney() {
    if (!token || !id || !origin.trim() || !destination.trim()) return;
    try {
      await api('/journeys', {
        token,
        body: {
          travel_space_id: id,
          origin_label: origin,
          destination_label: destination,
          mode,
          depart_on: depart ? isoDate(depart) : null,
          arrive_on: arrive ? isoDate(arrive) : null,
        },
      });
      setOrigin('');
      setDestination('');
      setDepart(null);
      setArrive(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the journey.');
    }
  }

  async function archive() {
    if (!token || !id) return;
    try {
      await api(`/travel-spaces/${id}`, { method: 'DELETE', token });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive this space.');
    }
  }

  return (
    <Screen safeTop onRefresh={load} refreshing={refreshing}>
      <View style={styles.hero}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.heroTitle}>{space?.title ?? 'Travel Space'}</Text>
        <Text style={styles.heroMeta}>
          {space ? `${space.status} · ${dates(space)}` : ' '}
        </Text>
      </View>
      <View style={styles.tabs}>
        {tabs.map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabOn]}>
            <Text style={[styles.tabLabel, tab === item && styles.tabLabelOn]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      {gmail === 'connected' ? (
        <Button label="Sync bookings and itinerary" onPress={syncMail} busy={syncing} />
      ) : (
        <Button label="Connect Gmail" tone="quiet" onPress={() => router.push('/gmail')} />
      )}
      <ErrorNote message={error} />

      {tab === 'Itinerary' ? (
        <>
          <View style={styles.days}>
            <Pressable onPress={() => setDay(null)} style={[styles.day, day === null && styles.dayOn]}>
              <Text style={[styles.dayLabel, day === null && styles.dayLabelOn]}>All</Text>
            </Pressable>
            {days.map((value) => (
              <Pressable key={value} onPress={() => setDay(value)} style={[styles.day, day === value && styles.dayOn]}>
                <Text style={[styles.dayLabel, day === value && styles.dayLabelOn]}>{value.slice(5)}</Text>
              </Pressable>
            ))}
          </View>
          {visible.length === 0 ? <Muted>Nothing on the itinerary yet.</Muted> : null}
          {groupByDay(visible).map(([dayKey, dayItems]) => (
            <View key={dayKey} style={styles.group}>
              <Text style={styles.section}>{dayKey === 'unscheduled' ? 'Unscheduled' : prettyDate(dayKey)}</Text>
              {dayItems.map((item) => (
                <Pressable
                  key={item.id}
                  disabled={!item.booking_id}
                  onPress={() => item.booking_id && router.push({ pathname: '/bookings/[id]', params: { id: item.booking_id } })}
                  style={styles.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Muted>
                      {[item.location_label, item.kind.replaceAll('_', ' '), item.status === 'confirmed' ? 'Confirmed' : 'Planned']
                        .filter(Boolean)
                        .join(' · ')}
                    </Muted>
                  </View>
                  <Text style={styles.clock}>{clockLabel(item.starts_at)}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          <View style={styles.actions}>
            <Button label="Add booking" onPress={() => router.push({ pathname: '/new-booking', params: { space: id } })} />
            <Button label="View on map" tone="quiet" onPress={() => router.push({ pathname: '/soon', params: { name: 'Map' } })} />
          </View>
          <Text style={styles.section}>Journey</Text>
          <Muted>A journey is the move between places. It shows on this itinerary once you save it.</Muted>
          <Field label="From" value={origin} onChangeText={setOrigin} placeholder="Colombo" />
          <Field label="To" value={destination} onChangeText={setDestination} placeholder="Munich" />
          <View style={styles.days}>
            {['flight', 'train', 'bus', 'car', 'other'].map((option) => (
              <Pressable key={option} onPress={() => setMode(option)} style={[styles.day, mode === option && styles.dayOn]}>
                <Text style={[styles.dayLabel, mode === option && styles.dayLabelOn]}>{option}</Text>
              </Pressable>
            ))}
          </View>
          <DateField label="Departs" value={depart} onChange={setDepart} placeholder="Choose a date" />
          <DateField label="Arrives" value={arrive} onChange={setArrive} placeholder="Choose a date" />
          <Button label="Add journey" tone="quiet" onPress={addJourney} />
        </>
      ) : null}

      {tab === 'Bookings' ? (
        <>
          {bookings.length === 0 ? <Muted>No bookings linked to this space.</Muted> : null}
          {groupBookings(bookings).map(([category, rows]) => (
            <View key={category} style={styles.group}>
              <Text style={styles.section}>{categoryLabels[category] ?? category.replaceAll('_', ' ')}</Text>
              {rows.map((booking) => (
                <Pressable
                  key={booking.id}
                  onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: booking.id } })}
                  style={styles.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{booking.location_label || booking.provider}</Text>
                    <Muted>
                      {[
                        booking.provider,
                        bookingRange(booking),
                        booking.confirmation_reference,
                        booking.status,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Muted>
                    {booking.price_amount ? (
                      <Muted>
                        {booking.price_currency ? `${booking.price_currency} ` : ''}
                        {booking.price_amount}
                      </Muted>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
          <Button label="Add booking" onPress={() => router.push({ pathname: '/new-booking', params: { space: id } })} />
          <Button label="Paste a confirmation" tone="quiet" onPress={() => router.push('/import-confirmation')} />
        </>
      ) : null}

      {tab === 'Photos' ? (
        <View style={styles.note}>
          <Text style={styles.itemTitle}>Photos</Text>
          <Muted>
            Photographs for this Travel Space will be organized here by place and day. The photo library is not connected, so nothing is imported.
          </Muted>
        </View>
      ) : null}

      {tab === 'Budget' ? (
        <View style={styles.note}>
          <Text style={styles.itemTitle}>Budget is not tracked yet</Text>
          <Muted>Spent and remaining amounts will show here from your expenses. This version will not display a sample total.</Muted>
        </View>
      ) : null}

      {tab === 'Docs' ? (
        <View style={styles.note}>
          <Text style={styles.itemTitle}>Travel wallet is not in this version</Text>
          <Muted>Passports, visas, and tickets will live here. Nothing is stored as a document yet.</Muted>
        </View>
      ) : null}

      <Text style={styles.section}>Stay</Text>
      {stays.map((stay) => (
        <View key={stay.id} style={styles.item}>
          <View>
            <Text style={styles.itemTitle}>{stay.title}</Text>
            <Muted>{[stay.start_date, stay.end_date].filter(Boolean).join(' – ') || 'Dates open'}</Muted>
          </View>
        </View>
      ))}
      <Field label="Stay name" value={stayTitle} onChangeText={setStayTitle} placeholder="Apartment or hotel" />
      <Field label="From" value={stayStart} onChangeText={setStayStart} placeholder="YYYY-MM-DD" />
      <Field label="Until" value={stayEnd} onChangeText={setStayEnd} placeholder="YYYY-MM-DD" />
      <Button label="Add stay" tone="quiet" onPress={addStay} />

      <Text style={styles.section}>Saved places</Text>
      {places.map((place) => (
        <View key={place.id} style={styles.item}>
          <Text style={styles.itemTitle}>{place.name}</Text>
        </View>
      ))}
      <Field label="Place" value={placeName} onChangeText={setPlaceName} placeholder="A place you want to keep" />
      <Button label="Save place" tone="quiet" onPress={addPlace} />
      <Button label="Archive space" tone="quiet" onPress={archive} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: theme.mossDeep, borderRadius: 24, padding: 18, gap: 6, marginHorizontal: -4 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  backLabel: { color: '#fff', fontSize: 24, lineHeight: 26 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '700' },
  heroMeta: { color: '#d7ebe3', textTransform: 'capitalize' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  tabOn: { backgroundColor: theme.moss },
  tabLabel: { color: theme.ink, fontWeight: '600' },
  tabLabelOn: { color: '#fff' },
  days: { flexDirection: 'row', gap: 8 },
  day: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  dayOn: { backgroundColor: theme.ink },
  dayLabel: { color: theme.ink, fontWeight: '600' },
  dayLabelOn: { color: '#fff' },
  item: { backgroundColor: '#fff', borderRadius: 18, padding: 14, flexDirection: 'row', gap: 8, alignItems: 'center' },
  itemTitle: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  clock: { color: theme.moss, fontWeight: '700' },
  actions: { gap: 10 },
  note: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 6 },
  group: { gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink, marginTop: 8, textTransform: 'capitalize' },
});
