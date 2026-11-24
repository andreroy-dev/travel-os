import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ChoicePicker, CurrencyPicker } from '@/components/Pickers';
import { MoneyRow } from '@/components/MoneyRow';
import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { loadCached } from '@/lib/cache';
import { currencyByCode } from '@/lib/currencies';
import { addAmounts, categoryLabel, inMonth, money, monthName } from '@/lib/display';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

type MoneyRow = {
  currency: string;
  expenses: string;
  recurring: string;
  combined: string;
  budget: string | null;
  remaining: string | null;
};
type Quote = {
  home_currency: string;
  total: string | null;
  lines: { currency: string; amount: string; converted: string | null; rate: string | null }[];
  missing: string[];
  rate_date: string | null;
  fetched_at: string | null;
  stale: boolean;
  note: string;
};
type Split = { name: string; amount: string };
type Expense = {
  id: string;
  name: string | null;
  category: string | null;
  amount: string | null;
  currency: string | null;
  spent_on: string | null;
  splits?: Split[];
};

const categories = [
  ['groceries', 'Food'],
  ['transport', 'Transport'],
  ['rent', 'Stay'],
  ['entertainment', 'Activities'],
  ['utilities', 'Bills'],
  ['fitness', 'Fitness'],
  ['other', 'Other'],
] as const;

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ExpensesScreen() {
  const { space } = useLocalSearchParams<{ space?: string }>();
  const { token, user } = useSession();
  const router = useRouter();
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(space ?? null);
  const [scope, setScope] = useState<'trip' | 'month'>('trip');
  const [rows, setRows] = useState<MoneyRow[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [category, setCategory] = useState<(typeof categories)[number][0]>('groceries');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [people, setPeople] = useState('');
  const [adding, setAdding] = useState(false);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [booked, setBooked] = useState<{ currency: string; amount: string; count: number }[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const trips = await api<TravelSpace[]>('/travel-spaces', { token });
    const open = trips.filter((trip) => trip.status !== 'archived');
    setSpaces(open);
    const chosen = spaceId && open.some((trip) => trip.id === spaceId) ? spaceId : open[0]?.id ?? null;
    setSpaceId(chosen);
    if (!chosen) {
      setRows([]);
      setExpenses([]);
      return;
    }
    const now = new Date();
    const [summary, history, preferences, exchange, tripSummary] = await loadCached(`expenses:${chosen}:${scope}:${token}`, () => Promise.all([
      api<{ currencies: MoneyRow[] }>(
        `/living/summary?travel_space_id=${chosen}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        { token },
      ),
      api<Expense[]>(`/living/expenses?travel_space_id=${chosen}`, { token }),
      api<{ home_currency: string }>('/preferences', { token }),
      api<Quote>(`/living/exchange?travel_space_id=${chosen}&scope=${scope}`, { token }),
      api<{ booked_costs?: { currency: string; amount: string; count: number }[] }>(`/travel-spaces/${chosen}/summary`, { token }),
    ]));
    setBooked(tripSummary.booked_costs ?? []);
    setRows(summary.currencies);
    setExpenses(history);
    setQuote(exchange);
    setCurrency(preferences.home_currency || 'EUR');
  }, [scope, spaceId, token]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load expenses.'));
    }, [load]),
  );

  async function removeExpense(expenseId: string) {
    if (!token) return;
    try {
      await api(`/living/expenses/${expenseId}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that expense.');
    }
  }

  async function add() {
    if (!token || !spaceId) return;
    setBusy(true);
    setError(null);
    try {
      await api('/living/expenses', {
        token,
        body: {
          travel_space_id: spaceId,
          name,
          amount,
          currency,
          category,
          spent_on: today(),
          split_with: people.split(',').map((item) => item.trim()).filter(Boolean),
        },
      });
      setName('');
      setAmount('');
      setPeople('');
      setReceiptNote(null);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that expense.');
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setReceiptNote(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (picked.canceled || !picked.assets[0]) return;
    const file = picked.assets[0].fileName?.replace(/\.[a-z0-9]+$/i, '') ?? '';
    if (file) setName(file);
    setAmount('');
    setReceiptNote('The picture is not read. Type the amount from the receipt.');
    setAdding(true);
  }

  const trip = spaces.find((item) => item.id === spaceId);
  const shown = scope === 'month' ? expenses.filter((item) => inMonth(item.spent_on)) : expenses;
  const currencies = [...new Set(shown.map((item) => item.currency).filter((item): item is string => Boolean(item)))].sort();
  const byCurrency = currencies.map((code) => ({
    code,
    amount: addAmounts(shown.filter((item) => item.currency === code).map((item) => item.amount)),
  }));
  const monthBudgets = scope === 'month' ? rows.filter((row) => row.budget) : [];
  const shares = new Map<string, string[]>();
  for (const expense of shown) {
    for (const split of expense.splits ?? []) {
      const key = `${split.name} ${expense.currency}`;
      shares.set(key, [...(shares.get(key) ?? []), split.amount]);
    }
  }
  const you = user?.display_name ?? '';
  const others = [...shares.entries()].filter(([key]) => !key.toLowerCase().startsWith(`${you.toLowerCase()} `));
  const home = currencyByCode(quote?.home_currency ?? currency);

  return (
    <Screen onRefresh={load} refreshing={busy}>
      <View style={styles.switch}>
        {(['trip', 'month'] as const).map((item) => (
          <Pressable key={item} onPress={() => setScope(item)} style={[styles.switchItem, scope === item && styles.switchOn]}>
            <Text style={[styles.switchText, scope === item && styles.switchTextOn]}>{item === 'trip' ? 'Trip' : 'Monthly'}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorNote message={error} />
      <View style={styles.chips}>
        {spaces.map((item) => (
          <Pressable key={item.id} onPress={() => setSpaceId(item.id)} style={[styles.chip, spaceId === item.id && styles.chipOn]}>
            <Text style={spaceId === item.id ? styles.chipOnText : styles.chipText}>{item.title}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setQuoteOpen(true)} style={styles.hero}>
        <Text style={styles.heroKicker}>
          {trip?.title ?? 'Trip'} · {scope === 'month' ? monthName() : 'spent so far'}
        </Text>
        {byCurrency.length === 0 ? <Text style={styles.heroAmount}>Nothing spent yet</Text> : null}
        {byCurrency.map((row) => (
          <View key={row.code} style={styles.heroLine}>
            <Text style={styles.heroName}>{currencyByCode(row.code)?.name ?? row.code}</Text>
            <Text style={styles.heroAmountSmall}>{row.code} {row.amount}</Text>
          </View>
        ))}
        <Text style={styles.heroMeta}>
          {home ? `Tap for the total in ${home.name}` : 'Tap for the total in your currency'}
        </Text>
        {monthBudgets.map((row) => (
          <Text key={row.currency} style={styles.heroMeta}>
            Budget {row.currency} {money(row.budget)} · {money(row.remaining)} left
          </Text>
        ))}
      </Pressable>
      {scope === 'trip' && booked.length > 0 ? (
        <Pressable onPress={() => spaceId && router.push(`/spaces/${spaceId}`)} style={styles.card}>
          <Text style={styles.section}>Booked in advance</Text>
          {booked.map((row) => (
            <View key={row.currency} style={styles.bookedRow}>
              <Text style={styles.bookedName}>
                {row.count} {row.count === 1 ? 'booking' : 'bookings'}
              </Text>
              <Text style={styles.bookedAmount}>
                {row.currency} {money(row.amount)}
              </Text>
            </View>
          ))}
          <Text style={styles.bookedNote}>
            From the prices on your confirmations. Included in the trip total; cancelled bookings drop out.
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.section}>By category</Text>
        {categories.map(([value, label]) => {
          const parts = currencies
            .map((code) => ({
              code,
              amount: addAmounts(shown.filter((item) => item.currency === code && (item.category ?? 'other') === value).map((item) => item.amount)),
            }))
            .filter((part) => part.amount !== '0.00');
          if (parts.length === 0) return null;
          return (
            <View key={value} style={styles.cat}>
              <Text style={styles.name}>{label}</Text>
              {parts.map((part) => (
                <Text key={part.code} style={styles.catAmount}>{part.code} {part.amount}</Text>
              ))}
            </View>
          );
        })}
        {shown.length === 0 ? <Muted>No expenses in this view yet.</Muted> : null}
      </View>
      <View style={styles.card}>
        <View style={styles.listHead}>
          <Text style={styles.section}>{scope === 'month' ? 'This month' : 'All expenses'}</Text>
          {shown.length > 8 ? (
            <Pressable onPress={() => setShowAll((value) => !value)}>
              <Text style={styles.link}>{showAll ? 'Show fewer' : `Show all ${shown.length}`}</Text>
            </Pressable>
          ) : null}
        </View>
        {(showAll ? shown : shown.slice(0, 8)).map((expense) => (
          <MoneyRow
            key={expense.id}
            title={expense.name ?? 'Expense'}
            detail={[
              categoryLabel[expense.category ?? 'other'] ?? expense.category,
              expense.spent_on,
              expense.splits?.length ? `split ${expense.splits.map((split) => split.name).join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            amount={`${expense.currency} ${money(expense.amount)}`}
            onDelete={() => removeExpense(expense.id)}
          />
        ))}
        {shown.length === 0 ? <Muted>Nothing logged yet.</Muted> : null}
      </View>
      {others.length > 0 ? (
        <View style={styles.share}>
          <Text style={styles.name}>
            Shares: {others.map(([key, amounts]) => `${key} ${addAmounts(amounts)}`).join(' · ')}
          </Text>
          <Muted>These are the shares stored on the expenses you logged.</Muted>
        </View>
      ) : null}
      <Sheet visible={quoteOpen} title={home ? `Total in ${home.name}` : 'Total'} onClose={() => setQuoteOpen(false)}>
        {quote?.lines.map((line) => (
          <View key={line.currency} style={styles.quoteLine}>
            <Text style={styles.name}>{line.currency} {line.amount}</Text>
            <Text style={styles.catAmount}>
              {line.converted && quote.home_currency
                ? `${quote.home_currency} ${line.converted}`
                : 'No rate'}
            </Text>
            {line.rate && line.currency !== quote?.home_currency ? (
              <Muted>1 {line.currency} = {line.rate} {quote?.home_currency}</Muted>
            ) : null}
          </View>
        ))}
        {quote?.total ? (
          <Text style={styles.quoteTotal}>{quote.home_currency} {quote.total}</Text>
        ) : (
          <Muted>{quote?.note ?? 'Open this again to load the rate.'}</Muted>
        )}
        {quote?.total ? <Muted>{quote.note}</Muted> : null}
        {quote?.rate_date ? <Muted>Rate date {quote.rate_date}{quote.stale ? ' · last saved table, the refresh did not succeed' : ''}</Muted> : null}
      </Sheet>
      <Sheet visible={adding} title="Add expense" onClose={() => setAdding(false)}>
        {receiptNote ? <Muted>{receiptNote}</Muted> : null}
        <Field label="What was it" value={name} onChangeText={setName} placeholder="Dinner, a train ticket" />
        <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
        <CurrencyPicker value={currency} onChange={setCurrency} />
        <ChoicePicker
          label="Category"
          value={category}
          options={categories.map(([value, label]) => ({ value, label }))}
          onChange={(value) => setCategory(value as (typeof categories)[number][0])}
        />
        <Field label="Split with" value={people} onChangeText={setPeople} placeholder="Names, including you" />
        <Button label="Save expense" onPress={add} busy={busy} />
      </Sheet>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button label="Add expense" onPress={() => setAdding(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Scan receipt" tone="quiet" onPress={() => void scan()} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: theme.moss, fontWeight: '700' },
  bookedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  bookedName: { color: theme.ink, fontWeight: '600' },
  bookedAmount: { color: theme.ink, fontWeight: '700' },
  bookedNote: { color: theme.muted, fontSize: 12, marginTop: 4 },
  switch: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: '#fff', borderRadius: 999, padding: 4 },
  switchItem: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  switchOn: { backgroundColor: theme.moss },
  switchText: { color: theme.ink, fontWeight: '700' },
  switchTextOn: { color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.moss, borderColor: theme.moss },
  chipText: { color: theme.ink, fontWeight: '600' },
  chipOnText: { color: '#fff', fontWeight: '600' },
  hero: { backgroundColor: theme.mossDeep, borderRadius: 24, padding: 18, gap: 8 },
  heroKicker: { color: '#d7ebe3', fontWeight: '600' },
  heroAmount: { color: '#fff', fontSize: 32, fontWeight: '700' },
  heroLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  heroName: { color: '#d7ebe3', fontSize: 16, fontWeight: '600' },
  heroAmountSmall: { color: '#fff', fontSize: 22, fontWeight: '700' },
  heroMeta: { color: '#d7ebe3' },
  catAmount: { color: theme.muted, fontWeight: '700' },
  quoteLine: { backgroundColor: '#fff', borderRadius: 16, padding: 14, gap: 2, borderWidth: 1, borderColor: theme.line },
  quoteTotal: { color: theme.ink, fontSize: 28, fontWeight: '700' },
  track: { height: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: theme.clay, borderRadius: 99 },
  fillQuiet: { height: 8, backgroundColor: theme.moss, borderRadius: 99 },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: theme.line },
  section: { fontSize: 18, fontWeight: '700', color: theme.ink },
  cat: { gap: 6 },
  catHead: { flexDirection: 'row', justifyContent: 'space-between' },
  line: { backgroundColor: '#fff', borderRadius: 16, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.line },
  name: { color: theme.ink, fontWeight: '700' },
  share: { backgroundColor: theme.mossSoft, borderRadius: 16, padding: 14, gap: 4 },
  actions: { flexDirection: 'row', gap: 10 },
});
