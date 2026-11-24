import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { Appear, PressableScale, SharedTitle } from '@/components/motion';
import { Sheet } from '@/components/Sheet';
import { Muted, theme } from '@/components/ui';
import { prettyDay } from '@/lib/dates';
import { tap } from '@/lib/haptics';
import type { Situation, TravelSpace } from '@/lib/types';

export type SpaceSummary = Situation & {
  documents?: number;
  booked_costs?: { currency: string; amount: string; count: number }[];
};

function Icon({ name, color, size = 20 }: { name: SFSymbol; color: string; size?: number }) {
  return (
    <SymbolView name={name} tintColor={color} size={size} fallback={<View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.25 }} />} />
  );
}

function Progress({ value }: { value: number }) {
  const width = useAnimatedStyle(() => ({ width: withTiming(`${Math.max(0, Math.min(1, value)) * 100}%`, { duration: 600 }) }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, width]} />
    </View>
  );
}

/**
 * Top of a Travel Space: who/where/when, live progress, the main actions,
 * and every module of the trip as a tile with its own live count.
 * Rare or destructive actions (edit, merge, archive) live behind the ••• button.
 */
export function SpaceHub({
  space,
  summary,
  gmail,
  syncing,
  onSync,
  onArchive,
  onRestore,
}: {
  space: TravelSpace;
  summary: SpaceSummary | null;
  gmail: string;
  syncing: boolean;
  onSync: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const router = useRouter();
  const [more, setMore] = useState(false);
  const id = space.id;
  const s = summary ?? {};
  const nights = s.nights;
  const archived = space.status === 'archived';
  const longStay = ['long_stay', 'relocation', 'open_ended'].includes(space.kind) || (s.total_days ?? 0) > 21;
  const go = (path: string) => {
    tap();
    router.push(path as '/wallet');
  };

  const when =
    s.days_until != null
      ? `In ${s.days_until} ${s.days_until === 1 ? 'day' : 'days'}`
      : s.day_number != null && s.total_days
        ? s.day_number > s.total_days
          ? 'Finished'
          : `Day ${s.day_number} of ${s.total_days}`
        : s.day_number != null
          ? `Day ${s.day_number}`
          : 'No dates yet';
  const spentRow = s.money?.[0];
  const booked = s.booked_costs?.[0];
  const openNights = (nights?.gaps ?? []).reduce((sum, gap) => sum + gap.nights, 0);

  const actions: { label: string; icon: SFSymbol; onPress: () => void; busy?: boolean }[] = [
    { label: 'Add booking', icon: 'plus', onPress: () => go(`/new-booking?space=${id}`) },
    { label: 'Import', icon: 'tray.and.arrow.down', onPress: () => go(`/import-confirmation?space=${id}`) },
    { label: 'Add travel', icon: 'tram.fill', onPress: () => go(`/add-journey?spaceId=${id}`) },
    {
      label: syncing ? 'Syncing…' : gmail === 'connected' ? 'Sync Gmail' : 'Gmail',
      icon: 'envelope.fill',
      onPress: () => (gmail === 'connected' ? onSync() : go('/gmail')),
      busy: syncing,
    },
  ];

  const tiles: { key: string; label: string; value: string; icon: SFSymbol; tint: string; onPress: () => void }[] = [
    {
      key: 'money',
      label: 'Expenses',
      value: booked
        ? `${booked.currency} ${booked.amount} booked`
        : spentRow
          ? `${spentRow.currency} ${spentRow.combined} this month`
          : 'Track spending',
      icon: 'creditcard.fill',
      tint: '#0f6e56',
      onPress: () => go(`/expenses?space=${id}`),
    },
    { key: 'map', label: 'Map', value: 'Bookings and places', icon: 'map.fill', tint: '#3d6f9e', onPress: () => go(`/map?space=${id}`) },
    {
      key: 'packing',
      label: 'Packing',
      value: s.packing?.total ? `${s.packing.packed} of ${s.packing.total} packed` : 'Start a list',
      icon: 'suitcase.fill',
      tint: '#b0632f',
      onPress: () => go(`/tools?space=${id}`),
    },
    {
      key: 'docs',
      label: 'Documents',
      value: s.documents ? `${s.documents} saved` : 'Passport, visas, tickets',
      icon: 'doc.text.fill',
      tint: '#6b5bd2',
      onPress: () => go('/wallet'),
    },
    {
      key: 'photos',
      label: 'Memories',
      value: s.photos ? `${s.photos} ${s.photos === 1 ? 'photo' : 'photos'}` : 'Photos and journal',
      icon: 'photo.fill.on.rectangle.fill',
      tint: '#c2417a',
      onPress: () => router.push({ pathname: '/memories/[id]', params: { id } }),
    },
    {
      key: 'living',
      label: longStay ? 'Local life' : 'Visa and costs',
      value: longStay ? 'Rent, gyms, coworking, visa days' : 'Stay days and monthly costs',
      icon: 'house.fill',
      tint: '#2f7a8c',
      onPress: () => router.push({ pathname: '/living/[id]', params: { id } }),
    },
  ];

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <PressableScale onPress={() => router.back()} style={styles.glass}>
            <Text style={styles.glassLabel}>‹</Text>
          </PressableScale>
          <PressableScale
            onPress={() => {
              tap();
              setMore(true);
            }}
            style={styles.glass}
            accessibilityLabel="More options">
            <Text style={styles.glassLabel}>•••</Text>
          </PressableScale>
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusText}>{space.status}</Text>
        </View>
        <SharedTitle tag={`space-${id}`} style={styles.title}>
          {space.title}
        </SharedTitle>
        <Text style={styles.meta}>
          {[
            space.destination_name,
            space.start_date ? `${prettyDay(space.start_date)}${space.end_date ? ` → ${prettyDay(space.end_date)}` : ' · open-ended'}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{when}</Text>
            <Text style={styles.statLabel}>Timeline</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{nights ? `${nights.covered}/${nights.total}` : '—'}</Text>
            <Text style={styles.statLabel}>Nights sorted</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{s.bookings ? s.bookings.confirmed : '—'}</Text>
            <Text style={styles.statLabel}>Bookings</Text>
          </View>
        </View>
        {nights && nights.total > 0 ? (
          <View style={{ gap: 6 }}>
            <Progress value={nights.covered / nights.total} />
            <Text style={styles.progressText}>
              {openNights === 0 ? 'Somewhere to stay every night' : `${openNights} ${openNights === 1 ? 'night' : 'nights'} still open`}
            </Text>
          </View>
        ) : null}
      </View>

      {archived ? (
        <View style={styles.archived}>
          <Text style={styles.tileLabel}>This space is archived</Text>
          <Muted>Hidden from your trips. Everything inside it is kept.</Muted>
          <PressableScale onPress={onRestore} style={styles.restore}>
            <Text style={styles.restoreText}>Restore to active</Text>
          </PressableScale>
        </View>
      ) : null}

      <View style={styles.actions}>
        {actions.map((action) => (
          <PressableScale key={action.label} onPress={action.onPress} disabled={action.busy} style={styles.action}>
            <View style={styles.actionIcon}>
              <Icon name={action.icon} color={theme.moss} />
            </View>
            <Text style={styles.actionLabel} numberOfLines={1}>
              {action.label}
            </Text>
          </PressableScale>
        ))}
      </View>

      <View style={styles.grid}>
        {tiles.map((tile, index) => (
          <View key={tile.key} style={styles.cell}>
            <Appear index={index}>
              <PressableScale onPress={tile.onPress} style={styles.tile}>
                <View style={[styles.tileIcon, { backgroundColor: `${tile.tint}1a` }]}>
                  <Icon name={tile.icon} color={tile.tint} size={18} />
                </View>
                <Text style={styles.tileLabel}>{tile.label}</Text>
                <Text style={styles.tileValue} numberOfLines={2}>
                  {tile.value}
                </Text>
              </PressableScale>
            </Appear>
          </View>
        ))}
      </View>

      <Sheet visible={more} title={space.title} onClose={() => setMore(false)}>
        {(
          [
            ['Edit name, dates and destination', 'pencil', () => go(`/new-space?id=${id}`)],
            ['Merge another space into this one', 'arrow.triangle.merge', () => go(`/merge-space?id=${id}`)],
            ...(archived
              ? ([['Restore to active', 'arrow.uturn.backward', onRestore]] as const)
              : ([['Archive space', 'archivebox', onArchive]] as const)),
          ] as const
        ).map(([label, icon, action]) => (
          <PressableScale
            key={label}
            onPress={() => {
              setMore(false);
              action();
            }}
            style={styles.sheetRow}>
            <Icon name={icon as SFSymbol} color={label.startsWith('Archive') ? theme.danger : theme.ink} />
            <Text style={[styles.sheetLabel, label.startsWith('Archive') && { color: theme.danger }]}>{label}</Text>
          </PressableScale>
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: theme.mossDeep,
    borderRadius: 28,
    padding: 18,
    gap: 8,
    marginHorizontal: -4,
    shadowColor: '#0c5c48',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  glass: { minWidth: 38, height: 38, borderRadius: 19, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  glassLabel: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 22 },
  statusPill: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#d7ebe3', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  meta: { color: '#cfe5dc', fontSize: 15 },
  stats: { flexDirection: 'row', marginTop: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 12 },
  stat: { flex: 1, gap: 2 },
  statValue: { color: '#fff', fontSize: 16, fontWeight: '800' },
  statLabel: { color: '#a9cfc2', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: 4 },
  fill: { height: 6, borderRadius: 3, backgroundColor: theme.clay },
  progressText: { color: '#cfe5dc', fontSize: 13 },
  archived: { backgroundColor: theme.coralSoft, borderRadius: 18, padding: 14, gap: 6 },
  restore: { alignSelf: 'flex-start', backgroundColor: theme.moss, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 },
  restoreText: { color: '#fff', fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  action: { flex: 1, alignItems: 'center', gap: 6 },
  actionIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.line },
  actionLabel: { color: theme.ink, fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  cell: { width: '50%', padding: 5 },
  tile: { backgroundColor: '#fff', borderRadius: 20, padding: 14, gap: 6, minHeight: 116, borderWidth: 1, borderColor: theme.line },
  tileIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  tileValue: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.line },
  sheetLabel: { color: theme.ink, fontSize: 16, fontWeight: '600' },
});
