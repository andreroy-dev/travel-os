import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/motion';
import { Muted, theme } from '@/components/ui';
import { prettyDay } from '@/lib/dates';
import type { Dashboard, Situation } from '@/lib/types';

/**
 * The part of Home that changes with the traveller's situation (PRD 3.4):
 * at home, planning, on a short holiday, living somewhere, paused, or just back.
 * Every figure comes from records they saved; nothing here is estimated.
 */
export function HomeSituation({ dashboard }: { dashboard: Dashboard }) {
  const router = useRouter();
  const s: Situation = dashboard.situation ?? {};
  const space = dashboard.travel_space;
  const id = space?.id;
  const go = (path: string) => router.push(path as '/wallet');
  const money = s.money?.[0];
  const gaps = s.nights?.gaps ?? [];

  const cards: React.ReactNode[] = [];
  const card = (key: string, title: string, body: string, onPress?: () => void, tone: 'plain' | 'warn' | 'dark' = 'plain') =>
    cards.push(
      <PressableScale
        key={key}
        disabled={!onPress}
        onPress={onPress}
        style={[styles.card, tone === 'warn' && styles.warn, tone === 'dark' && styles.dark]}>
        <Text style={[styles.title, tone === 'dark' && styles.onDark]}>{title}</Text>
        <Text style={[styles.body, tone === 'dark' && styles.onDarkSoft]}>{body}</Text>
      </PressableScale>,
    );

  const tonight = () => {
    if (!s.tonight) return;
    const t = s.tonight;
    const progress = t.night_count && t.night_count > 1 ? ` · night ${t.night_index} of ${t.night_count}` : '';
    const label = t.status === 'transit' ? 'Travelling overnight' : t.status === 'gap' ? 'No stay saved for tonight' : 'Tonight';
    card(
      'tonight',
      label,
      t.status === 'gap' ? 'Add where you are sleeping so the itinerary is complete.' : `${t.title ?? ''}${progress}`,
      t.booking_id ? () => router.push({ pathname: '/bookings/[id]', params: { id: t.booking_id! } }) : id ? () => go(`/spaces/${id}`) : undefined,
      t.status === 'gap' ? 'warn' : 'dark',
    );
  };
  const openNights = () => {
    if (!s.nights || !id) return;
    if (gaps.length === 0) {
      card('nights', `${s.nights.covered} of ${s.nights.total} nights sorted`, 'Somewhere to stay every night.', () => go(`/spaces/${id}`));
      return;
    }
    const open = gaps.reduce((sum, gap) => sum + gap.nights, 0);
    card(
      'nights',
      `${open} ${open === 1 ? 'night' : 'nights'} still open`,
      gaps.slice(0, 2).map((gap) => `${prettyDay(gap.start)} → ${prettyDay(gap.end)}`).join(' · '),
      () => go(`/spaces/${id}`),
      'warn',
    );
  };
  const spend = (label: string) => {
    if (!id) return;
    card(
      'money',
      money ? `${label} · ${money.currency} ${money.combined}` : label,
      money?.budget ? `${money.remaining} left of ${money.currency} ${money.budget}` : money ? 'No budget set for this month' : 'Nothing logged yet',
      () => go(`/expenses?space=${id}`),
    );
  };
  const visa = () => {
    const tightest = [...(s.visa ?? [])].sort((a, b) => a.remaining_days - b.remaining_days)[0];
    if (!tightest || !id) return;
    card(
      'visa',
      tightest.remaining_days < 0 ? `${tightest.label}: ${-tightest.remaining_days} days over` : `${tightest.label}: ${tightest.remaining_days} days left`,
      `Counted from the entries you logged, of ${tightest.limit_days}. Not an entry decision.`,
      () => router.push({ pathname: '/living/[id]', params: { id } }),
      tightest.remaining_days <= 7 ? 'warn' : 'plain',
    );
  };

  switch (dashboard.mode) {
    case 'at_home': {
      const next = s.upcoming ?? [];
      if (next.length === 0) {
        card('plan', 'Plan your next trip', 'Create a Travel Space for a weekend, a holiday or months abroad.', () => go('/new-space'), 'dark');
      }
      for (const trip of next.slice(0, 3)) {
        card(
          `up-${trip.id}`,
          trip.title,
          trip.days_until != null
            ? `${trip.days_until === 0 ? 'Starts today' : `In ${trip.days_until} ${trip.days_until === 1 ? 'day' : 'days'}`} · ${prettyDay(trip.start_date)}${trip.end_date ? ` → ${prettyDay(trip.end_date)}` : ''}`
            : trip.status === 'planning'
              ? 'Planning · no dates yet'
              : 'Upcoming',
          () => go(`/spaces/${trip.id}`),
        );
      }
      if (s.trips_completed) card('history', `${s.trips_completed} ${s.trips_completed === 1 ? 'trip' : 'trips'} completed`, 'Your travel history', () => go('/(tabs)/trips'));
      break;
    }
    case 'planning':
    case 'upcoming': {
      card(
        'countdown',
        s.days_until != null ? `${s.days_until} ${s.days_until === 1 ? 'day' : 'days'} to go` : space?.start_date ? 'Starting now' : 'Dates not set yet',
        space?.start_date ? `${prettyDay(space.start_date)}${space.end_date ? ` → ${prettyDay(space.end_date)}` : ''}` : 'Add dates to see gaps and reminders.',
        id ? () => go(space?.start_date ? `/spaces/${id}` : `/new-space?id=${id}`) : undefined,
        'dark',
      );
      openNights();
      if (s.bookings) {
        card(
          'bookings',
          `${s.bookings.confirmed} confirmed ${s.bookings.confirmed === 1 ? 'booking' : 'bookings'}`,
          s.bookings.planned ? `${s.bookings.planned} still planned` : 'Import or add the rest from the trip',
          id ? () => go(`/spaces/${id}`) : undefined,
        );
      }
      if (id) {
        const p = s.packing;
        card(
          'packing',
          p && p.total ? `Packing ${p.packed} of ${p.total}` : 'Preparation checklist',
          p && p.total ? (p.packed === p.total ? 'All packed' : `${p.total - p.packed} to go`) : 'Start a packing and documents list',
          () => go(`/tools?space=${id}`),
        );
      }
      visa();
      break;
    }
    case 'short_holiday': {
      tonight();
      openNights();
      spend('Spent this month');
      const toVisit = (s.places?.saved ?? 0) + (s.places?.considering ?? 0);
      if (id) card('places', toVisit ? `${toVisit} saved ${toVisit === 1 ? 'place' : 'places'} to visit` : 'Save places to visit', 'Restaurants, sights and spots for this trip', () => go(`/spaces/${id}`));
      break;
    }
    case 'long_stay': {
      tonight();
      spend('This month');
      visa();
      openNights();
      if (id) card('local', 'Local life', 'Gyms, coworking, groceries, events and monthly costs', () => router.push({ pathname: '/living/[id]', params: { id } }));
      break;
    }
    case 'paused':
      card('paused', 'This trip is paused', 'Nothing is lost. Open it to pick up where you left off.', id ? () => go(`/spaces/${id}`) : undefined, 'warn');
      break;
    case 'post_trip': {
      if (id) {
        card(
          'memories',
          s.photos ? `${s.photos} ${s.photos === 1 ? 'photo' : 'photos'} saved` : 'Keep your memories',
          'Photos and journal notes from this trip',
          () => router.push({ pathname: '/memories/[id]', params: { id } }),
          'dark',
        );
        spend('Spent');
        const visited = s.places?.visited ?? 0;
        if (visited) card('visited', `${visited} ${visited === 1 ? 'place' : 'places'} visited`, 'From the places you marked', () => go(`/spaces/${id}`));
      }
      card('next', 'Plan your next journey', 'Start a new Travel Space', () => go('/new-space'));
      break;
    }
    default:
      break;
  }

  if (cards.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Muted>{dashboard.headline}</Muted>
      {cards}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 3, borderWidth: 1, borderColor: theme.line },
  warn: { backgroundColor: theme.coralSoft, borderColor: theme.clay },
  dark: { backgroundColor: theme.mossDeep, borderColor: theme.mossDeep },
  title: { color: theme.ink, fontSize: 17, fontWeight: '700' },
  body: { color: theme.muted },
  onDark: { color: '#fff' },
  onDarkSoft: { color: '#d7ebe3' },
});
