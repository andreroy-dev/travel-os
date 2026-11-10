import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, ErrorNote, Field, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { COUNTRIES } from '@/lib/countries';
import { useSession } from '@/lib/session';

const kinds = ['holiday', 'long_stay', 'relocation', 'open_ended', 'business', 'other'] as const;
const statuses = ['planning', 'upcoming', 'active', 'paused', 'completed'] as const;

function iso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function NewSpaceScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [country, setCountry] = useState<{ code: string; name: string } | null>(null);
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<(typeof kinds)[number]>('holiday');
  const [status, setStatus] = useState<(typeof statuses)[number]>('planning');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const countries = useMemo(() => {
    const query = countryQuery.trim().toLowerCase();
    if (!query) return COUNTRIES;
    return COUNTRIES.filter((item) => item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query));
  }, [countryQuery]);

  async function save() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api('/travel-spaces', {
        token,
        body: {
          title,
          kind,
          status,
          destination_name: destination.trim() || null,
          country_code: country?.code ?? null,
          start_date: start ? iso(start) : null,
          end_date: end ? iso(end) : null,
          summary: summary.trim() || null,
        },
      });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the space.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Six weeks in Lisbon" />
      <Field label="Destination" value={destination} onChangeText={setDestination} placeholder="Lisbon" />
      <Text style={styles.label}>Country</Text>
      <Pressable style={styles.picker} onPress={() => setCountryOpen(true)}>
        <Text style={country ? styles.pickerValue : styles.placeholder}>
          {country ? `${country.name} · ${country.code}` : 'Choose a country'}
        </Text>
      </Pressable>
      <Text style={styles.label}>Starts</Text>
      <Pressable style={styles.picker} onPress={() => setPicking(picking === 'start' ? null : 'start')}>
        <Text style={start ? styles.pickerValue : styles.placeholder}>{start ? iso(start) : 'Choose a start date'}</Text>
      </Pressable>
      {picking === 'start' ? (
        <DateTimePicker
          value={start ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS !== 'ios') setPicking(null);
            if (date) setStart(date);
          }}
        />
      ) : null}
      <Text style={styles.label}>Ends</Text>
      <Pressable style={styles.picker} onPress={() => setPicking(picking === 'end' ? null : 'end')}>
        <Text style={end ? styles.pickerValue : styles.placeholder}>{end ? iso(end) : 'Choose an end date, or leave open'}</Text>
      </Pressable>
      {picking === 'end' ? (
        <DateTimePicker
          value={end ?? start ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={start ?? undefined}
          onChange={(_, date) => {
            if (Platform.OS !== 'ios') setPicking(null);
            if (date) setEnd(date);
          }}
        />
      ) : null}
      {end ? <Button label="Clear end date" tone="quiet" onPress={() => setEnd(null)} /> : null}
      <Field label="Notes" value={summary} onChangeText={setSummary} multiline placeholder="Why this stay exists" />
      <Pills label="Kind" options={kinds} value={kind} onChange={setKind} />
      <Pills label="Status" options={statuses} value={status} onChange={setStatus} />
      <ErrorNote message={error} />
      <Button label="Save space" onPress={save} busy={busy} />
      <Modal visible={countryOpen} animationType="slide" onRequestClose={() => setCountryOpen(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Country</Text>
          <TextInput
            value={countryQuery}
            onChangeText={setCountryQuery}
            placeholder="Search"
            placeholderTextColor="#a3988b"
            style={styles.search}
            autoCapitalize="none"
          />
          <FlatList
            data={countries}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <Pressable
                style={styles.country}
                onPress={() => {
                  setCountry(item);
                  setCountryOpen(false);
                }}>
                <Text style={styles.pickerValue}>{item.name}</Text>
                <Text style={styles.placeholder}>{item.code}</Text>
              </Pressable>
            )}
          />
          <Button label="Close" tone="quiet" onPress={() => setCountryOpen(false)} />
        </View>
      </Modal>
    </Screen>
  );
}

function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pills}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable key={option} onPress={() => onChange(option)} style={[styles.pill, selected && styles.pillOn]}>
              <Text style={[styles.pillText, selected && styles.pillTextOn]}>{option.replaceAll('_', ' ')}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.muted, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  picker: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  pickerValue: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  placeholder: { color: '#8d8680', fontSize: 16 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pillOn: { backgroundColor: theme.moss, borderColor: theme.moss },
  pillText: { color: theme.ink, fontWeight: '600', textTransform: 'capitalize' },
  pillTextOn: { color: '#fff' },
  modal: { flex: 1, backgroundColor: theme.paper, padding: 20, paddingTop: 64, gap: 12 },
  modalTitle: { fontSize: 28, fontWeight: '700', color: theme.ink },
  search: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 12,
    fontSize: 16,
  },
  country: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
