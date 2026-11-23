import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { SpaceCalendar } from '@/components/SpaceCalendar';
import { SpacePlaces } from '@/components/SpacePlaces';
import { ApiError, api } from '@/lib/api';
import { bookingSections } from '@/lib/bookingFields';
import { confirmAction } from '@/lib/confirm';
import { prettyDay, weekday } from '@/lib/dates';
import { useSession } from '@/lib/session';
import type {
  Booking,
  CoverageNight,
  IngestResult,
  Integration,
  ItineraryItem,
  StayCoverage,
  StayGap,
  StayMove,
  TravelSpace,
} from '@/lib/types';

const tabs = ['Itinerary', 'Calendar', 'Bookings', 'Places', 'Photos', 'Budget', 'Docs'] as const;

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function tripDays(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last && days.length < 62) {
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    days.push(`${cursor.getFullYear()}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export default function SpaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const router = useRouter();
  const [space, setSpace] = useState<TravelSpace | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [coverage, setCoverage] = useState<StayCoverage | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Itinerary');
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gmail, setGmail] = useState<string>('disconnected');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setRefreshing(true);
    try {
      const [nextSpace, nextBookings, plan, integration, nextCoverage] = await Promise.all([
        api<TravelSpace>(`/travel-spaces/${id}`, { token }),
        api<Booking[]>(`/bookings?travel_space_id=${id}`, { token }),
        api<{ items: ItineraryItem[] }>(`/itinerary?view=chronological&travel_space_id=${id}`, { token }),
        api<Integration>('/integrations/gmail', { token }),
        api<StayCoverage>(`/travel-spaces/${id}/coverage`, { token }),
      ]);
      setGmail(integration.status);
      setCoverage(nextCoverage);
      setSpace(nextSpace);
      setBookings(nextBookings);
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

  const days = space?.start_date && space.end_date
    ? tripDays(space.start_date, space.end_date)
    : [...new Set(items.map((item) => item.starts_on).filter((value): value is string => Boolean(value)))];
  const visibleDays = day ? days.filter((value) => value === day) : days;

  const nightByDate = new Map<string, CoverageNight>((coverage?.nights ?? []).map((night) => [night.date, night]));
  const gapByStart = new Map<string, StayGap>((coverage?.gaps ?? []).map((gap) => [gap.start, gap]));
  const moveByDate = new Map<string, StayMove>((coverage?.moves ?? []).map((move) => [move.date, move]));
  const archived = space?.status === 'archived';

  async function archive() {
    if (!token || !id || !space) return;
    const ok = await confirmAction(
      'Archive this space?',
      `"${space.title}" will move to Archived in Travel Spaces. Bookings and itinerary are kept, and you can restore it at any time.`,
      'Archive',
    );
    if (!ok) return;
    try {
      await api(`/travel-spaces/${id}/archive`, { method: 'POST', token, body: {} });
      if (router.canGoBack()) router.back();
      else router.replace('/trips');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive this space.');
    }
  }

  async function restore() {
    if (!token || !id) return;
    try {
      setSpace(await api<TravelSpace>(`/travel-spaces/${id}/restore`, { method: 'POST', token, body: {} }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore this space.');
    }
  }

  async function removeStay(night: CoverageNight) {
    if (!token || !night.stay_id) return;
    const ok = await confirmAction('Remove this stay?', `"${night.title}" will be taken off your itinerary.`, 'Remove');
    if (!ok) return;
    try {
      await api(`/stays/${night.stay_id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this stay.');
    }
  }

  async function removeJourney(item: ItineraryItem) {
    if (!token || !item.journey_id) return;
    const ok = await confirmAction('Remove this journey?', `"${item.title}" will be taken off your itinerary.`, 'Remove');
    if (!ok) return;
    try {
      await api(`/journeys/${item.journey_id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this journey.');
    }
  }

  function addJourney(move?: StayMove) {
    router.push({
      pathname: '/add-journey',
      params: move ? { spaceId: id, date: move.date, from: move.from_title, to: move.to_title } : { spaceId: id },
    });
  }

  function addStay(gap: StayGap) {
    router.push({ pathname: '/add-stay', params: { spaceId: id, start: gap.start, end: gap.end } });
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
      {archived ? (
        <View style={styles.archivedNote}>
          <Text style={styles.itemTitle}>This space is archived</Text>
          <Muted>It is hidden from your trips. Everything inside it is still here.</Muted>
          <Button label="Restore to active spaces" onPress={restore} />
        </View>
      ) : null}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            <Pressable onPress={() => setDay(null)} style={[styles.day, day === null && styles.dayOn]}>
              <Text style={[styles.dayLabel, day === null && styles.dayLabelOn]}>All</Text>
            </Pressable>
            {days.map((value) => (
              <Pressable key={value} onPress={() => setDay(value)} style={[styles.day, day === value && styles.dayOn]}>
                <Text style={[styles.dayLabel, day === value && styles.dayLabelOn]}>{value.slice(5)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {coverage && coverage.total_nights > 0 ? (
            <View style={[styles.summary, coverage.gaps.length > 0 && styles.summaryWarn]}>
              <Text style={styles.itemTitle}>
                {coverage.covered_nights} of {coverage.total_nights} nights sorted
              </Text>
              <Muted>
                {coverage.gaps.length === 0
                  ? 'You have somewhere to stay every night of this trip.'
                  : coverage.gaps
                      .map((gap) => `${prettyDay(gap.start)} → ${prettyDay(gap.end)} (${gap.nights} ${gap.nights === 1 ? 'night' : 'nights'})`)
                      .join(' · ') + ' still open'}
              </Muted>
            </View>
          ) : null}
          {visibleDays.length === 0 ? <Muted>Nothing on the itinerary yet.</Muted> : null}
          {visibleDays.map((dayKey) => {
            const dayItems = items.filter((item) => item.starts_on === dayKey && item.kind !== 'stay');
            const night = nightByDate.get(dayKey);
            const gap = gapByStart.get(dayKey);
            const move = moveByDate.get(dayKey);
            const lastDay = space?.end_date === dayKey;
            return (
              <View key={dayKey} style={styles.group}>
                <Text style={styles.section}>
                  {weekday(dayKey)} · {prettyDate(dayKey)}
                </Text>
                {move && !move.has_transport ? (
                  <View style={styles.move}>
                    <Text style={styles.nightTitle}>Moving to {move.to_title}</Text>
                    <Muted>How are you getting there from {move.from_title}?</Muted>
                    <Pressable onPress={() => addJourney(move)} style={styles.moveAction}>
                      <Text style={styles.moveActionLabel}>Add travel</Text>
                    </Pressable>
                  </View>
                ) : null}
                {dayItems.map((item) => (
                  <Pressable
                    key={item.id}
                    disabled={!item.booking_id && !item.journey_id}
                    onPress={() => {
                      if (item.booking_id) router.push({ pathname: '/bookings/[id]', params: { id: item.booking_id } });
                      else if (item.journey_id) void removeJourney(item);
                    }}
                    style={styles.item}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Muted>
                        {[
                          item.kind === 'accommodation' ? 'check-in' : item.kind.replaceAll('_', ' '),
                          item.status === 'confirmed' ? 'Confirmed' : 'Planned',
                          item.journey_id ? 'tap to remove' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Muted>
                    </View>
                    <Text style={styles.clock}>{clockLabel(item.starts_at)}</Text>
                  </Pressable>
                ))}
                {night && night.status !== 'gap' ? (
                  <NightRow
                    night={night}
                    onOpen={() => night.booking_id && router.push({ pathname: '/bookings/[id]', params: { id: night.booking_id } })}
                    onRemove={() => removeStay(night)}
                  />
                ) : null}
                {gap ? (
                  <View style={styles.gap}>
                    <Text style={styles.itemTitle}>
                      No place to stay for {gap.nights} {gap.nights === 1 ? 'night' : 'nights'}
                    </Text>
                    <Muted>
                      Nothing is booked from the night of {prettyDay(gap.start)} until {prettyDay(gap.end)}. Are you staying
                      with a friend, or somewhere else we should add to your itinerary?
                    </Muted>
                    <View style={styles.gapActions}>
                      <Button label="I'm staying somewhere" onPress={() => addStay(gap)} />
                      <Button label="Find a place to book" tone="quiet" onPress={() => router.push('/discover')} />
                    </View>
                  </View>
                ) : null}
                {night?.status === 'gap' && !gap ? <Muted>No place to stay yet (see above).</Muted> : null}
                {lastDay ? <Muted>Last day of the trip — no stay needed tonight.</Muted> : null}
              </View>
            );
          })}
        </>
      ) : null}

      {tab === 'Bookings' ? (
        <>
          {bookingSections
            .filter((section) => section.always || bookings.some((booking) => section.categories.includes(booking.category)))
            .map((section) => {
              const rows = bookings.filter((booking) => section.categories.includes(booking.category));
              return (
            <View key={section.label} style={styles.group}>
              <Text style={styles.section}>{section.label}</Text>
              {rows.length === 0 ? <Muted>None from your confirmations yet.</Muted> : null}
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
              );
            })}
        </>
      ) : null}

      {tab === 'Places' && token && id ? <SpacePlaces spaceId={id} token={token} /> : null}

      {tab === 'Calendar' && space?.start_date && space.end_date ? (
        <SpaceCalendar
          start={space.start_date}
          end={space.end_date}
          items={items}
          coverage={coverage}
          onPickDay={(value) => {
            setDay(value);
            setTab('Itinerary');
          }}
        />
      ) : null}
      {tab === 'Calendar' && !(space?.start_date && space.end_date) ? (
        <Muted>Add start and end dates to this space to see a calendar.</Muted>
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

      <View style={styles.manage}>
        <Text style={styles.section}>Manage space</Text>
        <Button label="Edit name, dates and destination" tone="quiet" onPress={() => router.push({ pathname: '/new-space', params: { id } })} />
        <Button label="Add travel between places" tone="quiet" onPress={() => addJourney()} />
        <Button label="Add a booking manually" tone="quiet" onPress={() => router.push({ pathname: '/new-booking', params: { space: id } })} />
        <Button label="Merge another space into this one" tone="quiet" onPress={() => router.push({ pathname: '/merge-space', params: { id } })} />
        {archived ? null : <Button label="Archive space" tone="quiet" onPress={archive} />}
      </View>
    </Screen>
  );
}

function NightRow({ night, onOpen, onRemove }: { night: CoverageNight; onOpen: () => void; onRemove: () => void }) {
  const progress = night.night_count && night.night_count > 1 ? ` · night ${night.night_index} of ${night.night_count}` : '';
  const label =
    night.status === 'transit'
      ? `Overnight travel: ${night.title}`
      : night.status === 'own_stay'
        ? `Staying: ${night.title}`
        : `Staying at ${night.title}`;
  return (
    <Pressable onPress={night.status === 'own_stay' ? undefined : onOpen} style={styles.night}>
      <Text style={styles.nightIcon}>{night.status === 'transit' ? '✈︎' : '☾'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.nightTitle}>{label}</Text>
        <Muted>{night.status === 'own_stay' ? `Added by you${progress}` : `Tonight${progress}`}</Muted>
      </View>
      {night.status === 'own_stay' ? (
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      ) : null}
    </Pressable>
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
  move: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4, borderWidth: 1, borderColor: theme.line, borderStyle: 'dashed' },
  moveAction: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: theme.mossSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  moveActionLabel: { color: theme.moss, fontWeight: '700' },
  manage: { gap: 8, marginTop: 12 },
  archivedNote: { backgroundColor: theme.coralSoft, borderRadius: 18, padding: 16, gap: 8 },
  summary: { backgroundColor: theme.mossSoft, borderRadius: 18, padding: 14, gap: 4 },
  summaryWarn: { backgroundColor: theme.coralSoft },
  night: { backgroundColor: theme.mossSoft, borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  nightIcon: { color: theme.moss, fontSize: 18, width: 22, textAlign: 'center' },
  nightTitle: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  remove: { color: theme.danger, fontWeight: '600' },
  gap: { backgroundColor: theme.coralSoft, borderRadius: 18, padding: 16, gap: 8, borderWidth: 1, borderColor: theme.clay },
  gapActions: { gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink, marginTop: 8, textTransform: 'capitalize' },
});
