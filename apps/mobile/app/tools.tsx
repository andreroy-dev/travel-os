import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CurrencyPicker } from '@/components/Pickers';
import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { loadCached } from '@/lib/cache';
import { useSession } from '@/lib/session';
import type { Booking, TravelSpace } from '@/lib/types';

type Item = { id: string; kind: string; label: string; packed: boolean };
type Budget = { amount: string | null; currency: string | null };
type Quote = { home_currency: string; total: string | null; note: string; rate_date: string | null };
type Balance = { name: string; currency: string; amount: string };
type Settlement = { assumption: string; balances: Balance[]; skipped: number };

function zoneTime(zone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date());
  } catch {
    return null;
  }
}

function inclusiveDays(start: string, end: string) {
  const from = new Date(`${start}T00:00:00`).getTime();
  const to = new Date(`${end}T00:00:00`).getTime();
  if (to < from) return null;
  return Math.round((to - from) / 86400000) + 1;
}

export default function ToolsScreen() {
  const { space } = useLocalSearchParams<{ space?: string }>();
  const { token } = useSession();
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(space ?? null);
  const [items, setItems] = useState<Item[]>([]);
  const [budget, setBudget] = useState<Budget>({ amount: null, currency: null });
  const [spent, setSpent] = useState<Quote | null>(null);
  const [balances, setBalances] = useState<Settlement | null>(null);
  const [homeZone, setHomeZone] = useState('UTC');
  const [zones, setZones] = useState<string[]>([]);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('EUR');
  const [to, setTo] = useState('INR');
  const [converted, setConverted] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'packing' | 'document'>('packing');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState('EUR');
  const [sheet, setSheet] = useState<'item' | 'budget' | 'convert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const trips = await loadCached(`tools-trips:${token}`, () => api<TravelSpace[]>('/travel-spaces', { token }));
    const open = trips.filter((trip) => trip.status !== 'archived');
    setSpaces(open);
    const chosen = spaceId && open.some((trip) => trip.id === spaceId) ? spaceId : open[0]?.id ?? null;
    setSpaceId(chosen);
    const preferences = await api<{ home_currency: string; timezone: string }>('/preferences', { token });
    setHomeZone(preferences.timezone);
    setTo(preferences.home_currency);
    setBudgetCurrency(preferences.home_currency);
    if (!chosen) return;
    const [list, savedBudget, quote, settlement, bookings] = await loadCached(`tools:${chosen}:${token}`, () =>
      Promise.all([
        api<Item[]>(`/packing?travel_space_id=${chosen}`, { token }),
        api<Budget>(`/trip-budgets?travel_space_id=${chosen}`, { token }),
        api<Quote>(`/living/exchange?travel_space_id=${chosen}&scope=trip`, { token }),
        api<Settlement>(`/settlement?travel_space_id=${chosen}`, { token }),
        api<Booking[]>(`/bookings?travel_space_id=${chosen}`, { token }),
      ]),
    );
    setItems(list);
    setBudget(savedBudget);
    setSpent(quote);
    setBalances(settlement);
    setZones([...new Set(bookings.map((booking) => booking.timezone).filter((zone): zone is string => Boolean(zone)))]);
  }, [spaceId, token]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load tools.'));
    }, [load]),
  );

  async function addItem() {
    if (!token || !spaceId) return;
    setBusy(true);
    try {
      await api('/packing', { token, body: { travel_space_id: spaceId, label, kind } });
      setLabel('');
      setSheet(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: Item) {
    if (!token) return;
    try {
      await api(`/packing/${item.id}`, { method: 'PATCH', token, body: { packed: !item.packed } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that.');
    }
  }

  async function saveBudget() {
    if (!token || !spaceId) return;
    setBusy(true);
    try {
      await api('/trip-budgets', {
        method: 'PUT',
        token,
        body: { travel_space_id: spaceId, amount: budgetAmount, currency: budgetCurrency },
      });
      setSheet(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the budget.');
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    if (!token) return;
    setBusy(true);
    setConverted(null);
    try {
      const quote = await api<Quote>(`/fx/convert?amount=${amount}&from_currency=${from}&to_currency=${to}`, { token });
      setConverted(quote.total ? `${quote.home_currency} ${quote.total}` : quote.note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not convert that amount.');
    } finally {
      setBusy(false);
    }
  }

  const trip = spaces.find((item) => item.id === spaceId);
  const days = trip?.start_date && trip.end_date ? inclusiveDays(trip.start_date, trip.end_date) : null;
  const sameCurrency = budget.amount && spent?.total && budget.currency === spent.home_currency;
  const remaining = sameCurrency ? (Number(budget.amount) - Number(spent?.total)).toFixed(2) : null;
  const perDay = sameCurrency && days ? (Number(budget.amount) / days).toFixed(2) : null;
  const clocks = [...new Set([homeZone, ...zones])];

  return (
    <Screen onRefresh={load}>
      <Text style={styles.heading}>Tools</Text>
      <Muted>Packing, a trip budget, clocks from saved time zones, and a converter that uses the published rate.</Muted>
      <ErrorNote message={error} />
      <View style={styles.chips}>
        {spaces.map((item) => (
          <Pressable key={item.id} onPress={() => setSpaceId(item.id)} style={[styles.chip, spaceId === item.id && styles.chipOn]}>
            <Text style={spaceId === item.id ? styles.chipOnText : styles.chipText}>{item.title}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Trip budget</Text>
        {budget.amount ? (
          <Text style={styles.amount}>{budget.currency} {budget.amount}</Text>
        ) : (
          <Muted>No trip budget saved.</Muted>
        )}
        {spent?.total ? <Muted>Logged expenses convert to {spent.home_currency} {spent.total}</Muted> : <Muted>{spent?.note}</Muted>}
        {remaining !== null ? <Muted>{remaining} left of the budget, in {budget.currency}</Muted> : null}
        {perDay ? <Muted>{budget.currency} {perDay} if the budget is spread evenly across the {days} dates you set</Muted> : null}
        <Button label="Set trip budget" tone="quiet" onPress={() => setSheet('budget')} />
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Shares</Text>
        <Muted>{balances?.assumption}</Muted>
        {(balances?.balances ?? []).map((row) => (
          <Text key={`${row.name}-${row.currency}`} style={styles.line}>{row.name} · {row.currency} {row.amount}</Text>
        ))}
        {balances && balances.balances.length === 0 ? <Muted>No shares include your name yet.</Muted> : null}
      </View>

      <Text style={styles.section}>Packing</Text>
      {items.filter((item) => item.kind === 'packing').map((item) => (
        <Pressable key={item.id} onPress={() => toggle(item)} style={styles.lineRow}>
          <Text style={styles.box}>{item.packed ? '✓' : ''}</Text>
          <Text style={[styles.line, item.packed && styles.done]}>{item.label}</Text>
        </Pressable>
      ))}
      <Text style={styles.section}>Documents to bring</Text>
      {items.filter((item) => item.kind === 'document').map((item) => (
        <Pressable key={item.id} onPress={() => toggle(item)} style={styles.lineRow}>
          <Text style={styles.box}>{item.packed ? '✓' : ''}</Text>
          <Text style={[styles.line, item.packed && styles.done]}>{item.label}</Text>
        </Pressable>
      ))}
      <Button label="Add an item" onPress={() => setSheet('item')} />

      <Text style={styles.section}>Clocks</Text>
      <Muted>Times use the zone on your profile and any zone saved on a booking.</Muted>
      {clocks.map((zone) => (
        <View key={zone} style={styles.lineRow}>
          <Text style={styles.line}>{zone.split('/').pop()?.replaceAll('_', ' ')}</Text>
          <Text style={styles.line}>{zoneTime(zone) ?? zone}</Text>
        </View>
      ))}

      <Text style={styles.section}>Converter</Text>
      <Button label="Convert an amount" tone="quiet" onPress={() => setSheet('convert')} />
      {converted ? <Muted>{converted}</Muted> : null}

      <Sheet visible={sheet === 'item'} title="Add an item" onClose={() => setSheet(null)}>
        <Field label="Item" value={label} onChangeText={setLabel} placeholder="Charger, passport, insurance" />
        <View style={styles.chips}>
          {(['packing', 'document'] as const).map((value) => (
            <Pressable key={value} onPress={() => setKind(value)} style={[styles.chip, kind === value && styles.chipOn]}>
              <Text style={kind === value ? styles.chipOnText : styles.chipText}>{value === 'packing' ? 'Packing' : 'Document'}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Save" onPress={addItem} busy={busy} />
      </Sheet>
      <Sheet visible={sheet === 'budget'} title="Trip budget" onClose={() => setSheet(null)}>
        <Field label="Amount" value={budgetAmount} onChangeText={setBudgetAmount} placeholder="0.00" keyboardType="decimal-pad" />
        <CurrencyPicker value={budgetCurrency} onChange={setBudgetCurrency} />
        <Button label="Save budget" onPress={saveBudget} busy={busy} />
      </Sheet>
      <Sheet visible={sheet === 'convert'} title="Convert" onClose={() => setSheet(null)}>
        <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="10" keyboardType="decimal-pad" />
        <CurrencyPicker value={from} onChange={setFrom} />
        <CurrencyPicker value={to} onChange={setTo} />
        <Button label="Convert" onPress={convert} busy={busy} />
        {converted ? <Text style={styles.amount}>{converted}</Text> : null}
        <Muted>The rate is the same European Central Bank table used on Expenses. It refreshes every hour.</Muted>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 32, fontWeight: '700', color: theme.ink },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink, marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6, borderWidth: 1, borderColor: theme.line },
  amount: { color: theme.ink, fontSize: 24, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.moss, borderColor: theme.moss },
  chipText: { color: theme.ink, fontWeight: '600' },
  chipOnText: { color: '#fff', fontWeight: '600' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.line },
  line: { color: theme.ink, fontWeight: '600', flex: 1 },
  done: { color: theme.muted, textDecorationLine: 'line-through' },
  box: { width: 22, color: theme.moss, fontWeight: '700' },
});
