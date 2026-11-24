import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FadePanel, PressableScale, SkeletonList, Toast } from '@/components/motion';
import { Button, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { SpaceCalendar } from '@/components/SpaceCalendar';
import { SpaceHub, type SpaceSummary } from '@/components/SpaceHub';
import { SpacePlaces } from '@/components/SpacePlaces';
import { StaySearchSheet } from '@/components/StaySearchSheet';
import { ApiError, api } from '@/lib/api';
import { loadCached } from '@/lib/cache';
import { bookingSections } from '@/lib/bookingFields';
import { confirmAction } from '@/lib/confirm';
import { prettyDay, weekday } from '@/lib/dates';
import { success, tap } from '@/lib/haptics';
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

const tabs = ['Itinerary', 'Calendar', 'Bookings', 'Places'] as const;
type SpaceTab = (typeof tabs)[number];

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  // Long stays and open-ended spaces can run for months; coverage is computed up to 400 nights.
  while (cursor <= last && days.length < 400) {
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
  const [tab, setTab] = useState<SpaceTab>('Itinerary');
  const [summary, setSummary] = useState<SpaceSummary | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [searchGap, setSearchGap] = useState<StayGap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gmail, setGmail] = useState<string>('disconnected');
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setRefreshing(true);
    try {
      const [nextSpace, nextBookings, plan, integration, nextCoverage] = await loadCached(
        `space:${id}:${token}`,
        () =>
          Promise.all([
            api<TravelSpace>(`/travel-spaces/${id}`, { token }),
            api<Booking[]>(`/bookings?travel_space_id=${id}`, { token }),
            api<{ items: ItineraryItem[] }>(`/itinerary?view=chronological&travel_space_id=${id}`, { token }),
            api<Integration>('/integrations/gmail', { token }),
            api<StayCoverage>(`/travel-spaces/${id}/coverage`, { token }),
          ]),
      );
      setGmail(integration.status);
      setCoverage(nextCoverage);
      setSpace(nextSpace);
      setBookings(nextBookings);
      setItems(plan.items ?? []);
      setSummary(await api<SpaceSummary>(`/travel-spaces/${id}/summary`, { token }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this space.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
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
        success();
        setNotice(filed === 1 ? 'Filed 1 booking.' : `Filed ${filed} bookings.`);
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
  // Long trips are browsed a month at a time so the screen stays light.
  const longTrip = days.length > 45;
  const tripMonths = [...new Set(days.map((value) => value.slice(0, 7)))];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const activeMonth = month ?? (tripMonths.includes(thisMonth) ? thisMonth : tripMonths[0] ?? null);
  const monthDays = longTrip && activeMonth ? days.filter((value) => value.startsWith(activeMonth)) : days;
  const visibleDays = day ? days.filter((value) => value === day) : monthDays;

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

  async function removePlan(item: ItineraryItem) {
    if (!token) return;
    const ok = await confirmAction('Remove this plan?', `"${item.title}" will be taken off the itinerary.`, 'Remove');
    if (!ok) return;
    try {
      await api(`/itinerary/plans/${item.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this plan.');
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

  async function dismissPrompt(kind: 'gap' | 'move', key: string) {
    if (!token || !id) return;
    try {
      await api(`/travel-spaces/${id}/prompts/dismiss`, { method: 'POST', token, body: { kind, key } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not hide that prompt.');
    }
  }

  return (
    <Screen safeTop onRefresh={load} refreshing={refreshing}>
      {space ? (
        <SpaceHub
          space={space}
          summary={summary}
          gmail={gmail}
          syncing={syncing}
          onSync={() => void syncMail()}
          onArchive={() => void archive()}
          onRestore={() => void restore()}
        />
      ) : (
        <SkeletonList count={2} />
      )}
      <View style={styles.segment}>
        {tabs.map((item) => (
          <PressableScale
            key={item}
            onPress={() => {
              tap();
              setTab(item);
            }}
            style={[styles.segmentItem, tab === item && styles.segmentOn]}>
            <Text style={[styles.segmentLabel, tab === item && styles.segmentLabelOn]}>{item}</Text>
          </PressableScale>
        ))}
      </View>
      <ErrorNote message={error} />
      <Toast message={notice} />
      {!loaded ? <SkeletonList count={4} /> : null}

      {loaded && tab === 'Itinerary' ? (
        <FadePanel panelKey={`itinerary-${day ?? 'all'}`}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            {longTrip
              ? tripMonths.map((value) => {
                  const on = day === null && value === activeMonth;
                  const [y, m] = value.split('-');
                  return (
                    <PressableScale
                      key={value}
                      onPress={() => {
                        setDay(null);
                        setMonth(value);
                      }}
                      style={[styles.day, on && styles.dayOn]}>
                      <Text style={[styles.dayLabel, on && styles.dayLabelOn]}>{`${months[Number(m) - 1]} ${y.slice(2)}`}</Text>
                    </PressableScale>
                  );
                })
              : null}
            {longTrip ? null : (
              <PressableScale onPress={() => setDay(null)} style={[styles.day, day === null && styles.dayOn]}>
                <Text style={[styles.dayLabel, day === null && styles.dayLabelOn]}>All</Text>
              </PressableScale>
            )}
            {(longTrip ? [] : days).map((value) => (
              <PressableScale key={value} onPress={() => setDay(value)} style={[styles.day, day === value && styles.dayOn]}>
                <Text style={[styles.dayLabel, day === value && styles.dayLabelOn]}>{`${weekday(value).slice(0, 3)} ${Number(value.slice(8))}`}</Text>
              </PressableScale>
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
              <View key={dayKey} style={styles.dayCard}>
                <View style={styles.dayHead}>
                  <Text style={styles.dayName}>{weekday(dayKey)}</Text>
                  <Text style={styles.dayDate}>{prettyDate(dayKey)}</Text>
                </View>
                {move && !move.has_transport ? (
                  <View style={styles.prompt}>
                    <Text style={styles.itemTitle}>Travel to {move.to_title}</Text>
                    <Muted>From {move.from_title}</Muted>
                    <View style={styles.promptActions}>
                      <Button label="Add travel" onPress={() => addJourney(move)} />
                      <Button label="I've sorted this" tone="quiet" onPress={() => dismissPrompt('move', move.date)} />
                    </View>
                  </View>
                ) : null}
                {dayItems.map((item) => (
                  <PressableScale
                    key={item.id}
                    onPress={() => {
                      if (item.booking_id) router.push({ pathname: '/bookings/[id]', params: { id: item.booking_id } });
                      else if (item.journey_id) void removeJourney(item);
                      else void removePlan(item);
                    }}
                    style={styles.slot}>
                    <Text style={styles.slotTime}>{clockLabel(item.starts_at) || '—'}</Text>
                    <View style={styles.rail}>
                      <View style={styles.dot} />
                    </View>
                    <View style={styles.slotBody}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Muted>
                        {item.kind === 'accommodation' ? 'Check-in' : item.kind.replaceAll('_', ' ')}
                        {item.status === 'confirmed' ? ' · Confirmed' : item.status === 'planned' ? ' · Planned' : ''}
                        {item.journey_id || (!item.booking_id && item.status === 'planned') ? ' · tap to remove' : ''}
                      </Muted>
                    </View>
                  </PressableScale>
                ))}
                {night && night.status !== 'gap' ? (
                  <NightRow
                    night={night}
                    onOpen={() => night.booking_id && router.push({ pathname: '/bookings/[id]', params: { id: night.booking_id } })}
                    onRemove={() => removeStay(night)}
                  />
                ) : null}
                {gap ? (
                  <View style={styles.prompt}>
                    <Text style={styles.itemTitle}>
                      {gap.nights} {gap.nights === 1 ? 'night' : 'nights'} open
                    </Text>
                    <Muted>
                      {prettyDay(gap.start)} to {prettyDay(gap.end)}
                    </Muted>
                    <View style={styles.promptActions}>
                      <Button label="I'm staying somewhere" onPress={() => addStay(gap)} />
                      <Button label="Find a place to book" tone="quiet" onPress={() => setSearchGap(gap)} />
                      <Button label="I've sorted this" tone="quiet" onPress={() => dismissPrompt('gap', gap.start)} />
                    </View>
                  </View>
                ) : null}
                {lastDay && !dayItems.length && !night ? <Muted>Departure day.</Muted> : null}
              </View>
            );
          })}
        </FadePanel>
      ) : null}

      {loaded && tab === 'Bookings' ? (
        <FadePanel panelKey="bookings">
          {bookingSections
            .filter((section) => section.always || bookings.some((booking) => section.categories.includes(booking.category)))
            .map((section) => {
              const rows = bookings.filter((booking) => section.categories.includes(booking.category));
              return (
            <View key={section.label} style={styles.group}>
              <Text style={styles.section}>{section.label}</Text>
              {rows.length === 0 ? <Muted>None from your confirmations yet.</Muted> : null}
              {rows.map((booking) => (
                <PressableScale
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
                </PressableScale>
              ))}
            </View>
              );
            })}
        </FadePanel>
      ) : null}

      {loaded && tab === 'Places' && token && id ? <SpacePlaces spaceId={id} token={token} start={space?.start_date} end={space?.end_date} /> : null}

      {loaded && tab === 'Calendar' && space?.start_date && space.end_date ? (
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
      {token && id ? (
        <StaySearchSheet
          spaceId={id}
          token={token}
          gap={searchGap}
          defaultCity={space?.destination_name ?? ''}
          onClose={() => setSearchGap(null)}
        />
      ) : null}
      {loaded && tab === 'Calendar' && !(space?.start_date && space.end_date) ? (
        <Muted>Add start and end dates to this space to see a calendar.</Muted>
      ) : null}
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
    <PressableScale onPress={night.status === 'own_stay' ? undefined : onOpen} style={styles.night}>
      <Text style={styles.nightIcon}>{night.status === 'transit' ? '✈︎' : '☾'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.nightTitle}>{label}</Text>
        <Muted>{night.status === 'own_stay' ? `Added by you${progress}` : `Tonight${progress}`}</Muted>
      </View>
      {night.status === 'own_stay' ? (
        <PressableScale onPress={onRemove}>
          <Text style={styles.remove}>Remove</Text>
        </PressableScale>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  days: { flexDirection: 'row', gap: 8 },
  day: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  dayOn: { backgroundColor: theme.ink },
  dayLabel: { color: theme.ink, fontWeight: '600' },
  dayLabelOn: { color: '#fff' },
  dayCard: { backgroundColor: '#fff', borderRadius: 22, padding: 14, gap: 10, borderWidth: 1, borderColor: theme.line },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  dayName: { color: theme.ink, fontSize: 18, fontWeight: '700' },
  dayDate: { color: theme.muted, fontWeight: '600' },
  slot: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  slotTime: { width: 48, color: theme.moss, fontWeight: '700', paddingTop: 12 },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.moss, marginTop: 16 },
  slotBody: { flex: 1, backgroundColor: theme.paper, borderRadius: 16, padding: 12, gap: 2 },
  prompt: { backgroundColor: theme.coralSoft, borderRadius: 16, padding: 12, gap: 8 },
  promptActions: { gap: 8 },
  item: { backgroundColor: '#fff', borderRadius: 18, padding: 14, flexDirection: 'row', gap: 8, alignItems: 'center' },
  itemTitle: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  clock: { color: theme.moss, fontWeight: '700' },
  segment: { flexDirection: 'row', backgroundColor: '#e6ece8', borderRadius: 14, padding: 4 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  segmentOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentLabel: { color: theme.muted, fontWeight: '600', fontSize: 14 },
  segmentLabelOn: { color: theme.ink },
  note: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 6 },
  group: { gap: 8 },
  move: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4, borderWidth: 1, borderColor: theme.line, borderStyle: 'dashed' },
  moveAction: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: theme.mossSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  moveActionLabel: { color: theme.moss, fontWeight: '700' },
  manage: { gap: 8, marginTop: 12 },
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
