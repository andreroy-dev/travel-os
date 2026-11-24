import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChoicePicker, CurrencyPicker } from '@/components/Pickers';
import { MoneyRow } from '@/components/MoneyRow';
import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { monthName, ratio } from '@/lib/display';
import { currentBooking } from '@/lib/currentBooking';
import { useSession } from '@/lib/session';
import type { Booking, TravelSpace } from '@/lib/types';

type MoneyRow = {
  currency: string;
  expenses: string;
  recurring: string;
  combined: string;
  budget: string | null;
  remaining: string | null;
};

type Summary = { currencies: MoneyRow[]; note: string };

type Named = { id: string; name?: string | null; title?: string | null; category?: string | null; amount?: string | null; currency?: string | null };

type VisaLog = {
  id: string;
  label: string;
  rule: string;
  count: { used_days: number; remaining_days: number; disclaimer: string };
};

const sections = ['Money', 'Services', 'Area', 'Visa'] as const;

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function LivingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const router = useRouter();
  const [section, setSection] = useState<(typeof sections)[number]>('Money');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expenses, setExpenses] = useState<Named[]>([]);
  const [services, setServices] = useState<Named[]>([]);
  const [areas, setAreas] = useState<Named[]>([]);
  const [events, setEvents] = useState<Named[]>([]);
  const [visas, setVisas] = useState<VisaLog[]>([]);
  const [space, setSpace] = useState<TravelSpace | null>(null);
  const [stay, setStay] = useState<Booking | null>(null);
  const [stayCount, setStayCount] = useState(0);
  const [recurring, setRecurring] = useState<Named[]>([]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [source, setSource] = useState('');
  const [allowed, setAllowed] = useState('90');
  const [category, setCategory] = useState('gym');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'expense' | 'recurring' | 'budget' | 'service' | 'area' | 'event' | 'visa' | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    const now = new Date();
    const [nextSpace, nextSummary, nextExpenses, nextServices, nextAreas, nextEvents, nextVisas, nextBookings, nextRecurring] =
      await Promise.all([
        api<TravelSpace>(`/travel-spaces/${id}`, { token }),
        api<Summary>(`/living/summary?travel_space_id=${id}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { token }),
        api<Named[]>(`/living/expenses?travel_space_id=${id}`, { token }),
        api<Named[]>(`/living/services?travel_space_id=${id}`, { token }),
        api<Named[]>(`/living/neighbourhoods?travel_space_id=${id}`, { token }),
        api<Named[]>(`/living/events?travel_space_id=${id}`, { token }),
        api<VisaLog[]>('/living/visa-logs', { token }),
        api<Booking[]>(`/bookings?travel_space_id=${id}`, { token }),
        api<Named[]>(`/living/recurring?travel_space_id=${id}`, { token }),
      ]);
    setSpace(nextSpace);
    setSummary(nextSummary);
    setExpenses(nextExpenses);
    setServices(nextServices);
    setAreas(nextAreas);
    setEvents(nextEvents);
    setVisas(nextVisas);
    // The stay in progress today, else the next one: never just the first hotel booked.
    setStay(currentBooking(nextBookings, 'accommodation'));
    setStayCount(nextBookings.filter((b) => b.category === 'accommodation' && b.status !== 'cancelled').length);
    setRecurring(nextRecurring);
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load living costs.'));
    }, [load]),
  );

  async function remove(path: string) {
    if (!token) return;
    try {
      await api(path, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that.');
    }
  }

  async function run(task: () => Promise<void>) {
    if (!token || !id) return;
    setBusy(true);
    setError(null);
    try {
      await task();
      setName('');
      setAmount('');
      setSource('');
      setSheet(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={load} refreshing={busy}>
      <Text style={styles.kicker}>{space?.kind === 'long_stay' ? 'Long stay' : 'This trip'}</Text>
      <Text style={styles.heading}>Living in {space?.destination_name || space?.title || 'this place'}</Text>
      {stay ? (
        <Pressable onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: stay.id } })} style={styles.card}>
          <Text style={styles.stayKicker}>
            {stayLabel(stay)}
            {stayCount > 1 ? ` · 1 of ${stayCount} stays` : ''}
          </Text>
          <Text style={styles.cardTitle}>{String(stay.details?.property_name || stay.location_label || stay.provider)}</Text>
          <Muted>
            {[stay.provider, stay.starts_at?.slice(0, 10), stay.ends_at ? `until ${stay.ends_at.slice(0, 10)}` : null, stay.price_amount ? `${stay.price_currency ?? ''} ${stay.price_amount}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
          {stayCount > 1 ? (
            <Pressable onPress={() => router.push({ pathname: '/trip-bookings', params: { space: id, category: 'accommodation' } })}>
              <Text style={styles.stayLink}>See all {stayCount} stays ›</Text>
            </Pressable>
          ) : null}
        </Pressable>
      ) : null}
      {summary?.currencies.map((row) => (
        <View key={row.currency} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{monthName()} · {row.currency}</Text>
            <Pressable onPress={() => router.push(`/expenses?space=${id}`)}>
              <Text style={styles.link}>Expenses</Text>
            </Pressable>
          </View>
          <Text style={styles.amount}>{row.currency} {row.combined}{row.budget ? ` of ${row.budget}` : ''}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${ratio(row.combined, row.budget) * 100}%` }]} />
          </View>
          <Muted>
            Expenses {row.expenses} · monthly costs {row.recurring}
            {row.remaining ? ` · ${row.remaining} left of the budget you set` : ''}
          </Muted>
        </View>
      ))}
      {services.length ? (
        <View style={styles.block}>
          <Text style={styles.cardTitle}>Your places</Text>
          <View style={styles.tabs}>
            {services.map((service) => (
              <Pressable key={service.id} onPress={() => setSection('Services')} style={styles.place}>
                <Text style={styles.tabText}>{service.category}</Text>
                <Text style={styles.cardTitle}>{service.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {recurring.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recurring</Text>
          {recurring.map((row) => (
            <MoneyRow
              key={row.id}
              kind="monthly cost"
              title={row.name ?? 'Monthly cost'}
              amount={`${row.currency} ${row.amount}`}
              onDelete={() => remove(`/living/recurring/${row.id}`)}
            />
          ))}
        </View>
      ) : null}
      {visas[0] ? (
        <View style={styles.visa}>
          <Text style={styles.cardTitle}>{visas[0].label}: {visas[0].count.remaining_days} days left in the log</Text>
          <Muted>{visas[0].count.disclaimer}</Muted>
        </View>
      ) : null}
      <View style={styles.tabs}>
        {sections.map((item) => (
          <Pressable key={item} onPress={() => setSection(item)} style={[styles.tab, section === item && styles.tabOn]}>
            <Text style={section === item ? styles.tabOnText : styles.tabText}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorNote message={error} />
      {section === 'Money' ? (
        <View style={styles.block}>
          {expenses.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Expenses</Text>
              {expenses.map((row) => (
                <MoneyRow
                  key={row.id}
                  title={row.name ?? 'Expense'}
                  amount={`${row.currency} ${row.amount}`}
                  onDelete={() => remove(`/living/expenses/${row.id}`)}
                />
              ))}
            </View>
          ) : (
            <Muted>{summary?.note ?? 'No expenses logged for this trip yet.'}</Muted>
          )}
          <Button label="Add an expense" onPress={() => setSheet('expense')} />
          <Button label="Add a monthly cost" tone="quiet" onPress={() => setSheet('recurring')} />
          <Button label="Set this month's budget" tone="quiet" onPress={() => setSheet('budget')} />
        </View>
      ) : null}
      {section === 'Services' ? (
        <View style={styles.block}>
          <Muted>A service is a place you already use. Travel OS does not look any up.</Muted>
          {services.map((row) => (
            <Text key={row.id} style={styles.cardTitle}>{row.name}</Text>
          ))}
          <Button label="Add a place" onPress={() => setSheet('service')} />
        </View>
      ) : null}
      {section === 'Area' ? (
        <View style={styles.block}>
          <Muted>Notes you write. A safety note is kept only with the source you name.</Muted>
          {areas.map((row) => (
            <Text key={row.id} style={styles.cardTitle}>{row.name}</Text>
          ))}
          {events.map((row) => (
            <Muted key={row.id}>{row.title}</Muted>
          ))}
          <Button label="Add a neighbourhood note" onPress={() => setSheet('area')} />
          <Button label="Add an event" tone="quiet" onPress={() => setSheet('event')} />
        </View>
      ) : null}
      {section === 'Visa' ? (
        <View style={styles.block}>
          {visas.map((log) => (
            <View key={log.id} style={styles.card}>
              <Text style={styles.cardTitle}>{log.label}</Text>
              <Muted>
                {log.count.used_days} days counted · {log.count.remaining_days} left in the rule you chose
              </Muted>
              <Muted>{log.count.disclaimer}</Muted>
            </View>
          ))}
          <Button label="Log stay days" onPress={() => setSheet('visa')} />
        </View>
      ) : null}
      <Sheet
        visible={sheet !== null}
        title={
          sheet === 'expense'
            ? 'Add an expense'
            : sheet === 'recurring'
              ? 'Monthly cost'
              : sheet === 'budget'
                ? "This month's budget"
                : sheet === 'service'
                  ? 'A place you use'
                  : sheet === 'area'
                    ? 'Neighbourhood note'
                    : sheet === 'event'
                      ? 'An event you found'
                      : 'Stay days'
        }
        onClose={() => setSheet(null)}>
        {sheet === 'expense' || sheet === 'recurring' || sheet === 'budget' ? (
          <>
            {sheet !== 'budget' ? <Field label="Name" value={name} onChangeText={setName} placeholder="Rent, groceries, a deposit" /> : null}
            <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
            <CurrencyPicker value={currency} onChange={setCurrency} />
            <Button
              label="Save"
              busy={busy}
              onPress={() => {
                const now = new Date();
                if (sheet === 'expense') {
                  void run(() =>
                    api('/living/expenses', {
                      token,
                      body: { travel_space_id: id, name, amount, currency, category: 'other', spent_on: today() },
                    }),
                  );
                } else if (sheet === 'recurring') {
                  void run(() =>
                    api('/living/recurring', {
                      token,
                      body: { travel_space_id: id, name, amount, currency, category: 'rent', starts_on: today() },
                    }),
                  );
                } else {
                  void run(() =>
                    api('/living/budget', {
                      method: 'PUT',
                      token,
                      body: { travel_space_id: id, year: now.getFullYear(), month: now.getMonth() + 1, amount, currency },
                    }),
                  );
                }
              }}
            />
          </>
        ) : null}
        {sheet === 'service' ? (
          <>
            <Field label="Name" value={name} onChangeText={setName} placeholder="The gym, a coworking desk" />
            <ChoicePicker
              label="Kind"
              value={category}
              options={['gym', 'coworking', 'grocery', 'cafe', 'other'].map((item) => ({ value: item, label: item }))}
              onChange={setCategory}
            />
            <Button
              label="Save place"
              busy={busy}
              onPress={() => void run(() => api('/living/services', { token, body: { travel_space_id: id, name, category } }))}
            />
          </>
        ) : null}
        {sheet === 'area' ? (
          <>
            <Field label="Neighbourhood" value={name} onChangeText={setName} />
            <Field label="Safety source" value={source} onChangeText={setSource} placeholder="Only if you add a safety note" />
            <Button
              label="Save note"
              busy={busy}
              onPress={() =>
                void run(() =>
                  api('/living/neighbourhoods', {
                    token,
                    body: { travel_space_id: id, name, safety_note: source || null, safety_source: source || null },
                  }),
                )
              }
            />
          </>
        ) : null}
        {sheet === 'event' ? (
          <>
            <Field label="Event" value={name} onChangeText={setName} />
            <Button
              label="Save event"
              busy={busy}
              onPress={() =>
                void run(() => api('/living/events', { token, body: { travel_space_id: id, title: name, starts_on: today() } }))
              }
            />
          </>
        ) : null}
        {sheet === 'visa' ? (
          <>
            <Field label="Log name" value={name} onChangeText={setName} placeholder="Schengen, or a visa you hold" />
            <Field label="Allowed days" value={allowed} onChangeText={setAllowed} placeholder="Only for a countdown" keyboardType="number-pad" />
            <Button
              label="Start a 90/180 log"
              busy={busy}
              onPress={() =>
                void run(async () => {
                  const log = await api<VisaLog>('/living/visa-logs', {
                    token,
                    body: { label: name || 'Schengen log', rule: 'schengen_90_180' },
                  });
                  await api(`/living/visa-logs/${log.id}/spans`, { token, body: { entered_on: today() } });
                })
              }
            />
            <Button
              label="Start a countdown"
              tone="quiet"
              onPress={() =>
                void run(async () => {
                  const log = await api<VisaLog>('/living/visa-logs', {
                    token,
                    body: { label: name || 'Stay countdown', rule: 'countdown', allowed_days: Number(allowed) },
                  });
                  await api(`/living/visa-logs/${log.id}/spans`, { token, body: { entered_on: today() } });
                })
              }
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function stayLabel(stay: Booking) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = stay.starts_at?.slice(0, 10) ?? '';
  const end = stay.ends_at?.slice(0, 10) ?? start;
  if (start <= today && end > today) return 'Staying now';
  if (start > today) return 'Next stay';
  return 'Last stay';
}

const styles = StyleSheet.create({
  stayKicker: { color: theme.moss, fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  stayLink: { color: theme.moss, fontWeight: '700', marginTop: 4 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.line },
  tabOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  tabText: { color: theme.ink, fontWeight: '600' },
  tabOnText: { color: '#fff', fontWeight: '600' },
  block: { gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14, gap: 4, borderWidth: 1, borderColor: theme.line },
  cardTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  kicker: { color: theme.muted, fontWeight: '600' },
  heading: { fontSize: 32, fontWeight: '700', color: theme.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  amount: { fontSize: 22, fontWeight: '700', color: theme.ink },
  link: { color: theme.moss, fontWeight: '700' },
  track: { height: 8, borderRadius: 99, backgroundColor: theme.line, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: theme.moss },
  place: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4, borderWidth: 1, borderColor: theme.line, minWidth: 120 },
  visa: { backgroundColor: theme.mossSoft, borderRadius: 16, padding: 14, gap: 4 },
});
