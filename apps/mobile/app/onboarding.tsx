import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, ErrorNote, Field, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { COUNTRIES } from '@/lib/countries';
import { markOnboardingSkipped } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import type { Preferences } from '@/lib/types';

type Country = { code: string; name: string };
type CountryTarget = 'home_country' | 'residency_country' | 'passport_nationality';

const tripTypes = ['holiday', 'long_term', 'living_abroad', 'mixed'] as const;
const paces = ['relaxed', 'balanced', 'packed'] as const;
const climates = ['warm', 'mild', 'cold', 'any'] as const;
const priorities = ['home', 'destination'] as const;

const countryLabels: Record<CountryTarget, string> = {
  home_country: 'Home country',
  residency_country: 'Where you live now',
  passport_nationality: 'Passport nationality',
};

function findCountry(code: string | null | undefined): Country | null {
  if (!code) return null;
  return COUNTRIES.find((item) => item.code === code.toUpperCase()) ?? null;
}

export default function OnboardingScreen() {
  const { token } = useSession();
  const router = useRouter();
  const [countries, setCountries] = useState<Record<CountryTarget, Country | null>>({
    home_country: null,
    residency_country: null,
    passport_nationality: null,
  });
  const [picking, setPicking] = useState<CountryTarget | null>(null);
  const [query, setQuery] = useState('');
  const [tripType, setTripType] = useState<(typeof tripTypes)[number] | null>(null);
  const [pace, setPace] = useState<(typeof paces)[number] | null>(null);
  const [climate, setClimate] = useState<(typeof climates)[number] | null>(null);
  const [priority, setPriority] = useState<(typeof priorities)[number] | null>(null);
  const [availableTime, setAvailableTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from whatever the server already knows, so editing later works too.
  useEffect(() => {
    if (!token) return;
    api<Preferences>('/preferences', { token })
      .then((prefs) => {
        setCountries({
          home_country: findCountry(prefs.home_country),
          residency_country: findCountry(prefs.residency_country),
          passport_nationality: findCountry(prefs.passport_nationality),
        });
        setTripType(prefs.trip_type ?? null);
        setPace(prefs.pace ?? null);
        setClimate(prefs.climate ?? null);
        setPriority(prefs.provider_priority ?? null);
        setAvailableTime(prefs.available_time ?? '');
      })
      .catch(() => undefined);
  }, [token]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COUNTRIES;
    return COUNTRIES.filter((item) => item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle));
  }, [query]);

  const ready = Boolean(countries.home_country && countries.passport_nationality);

  async function save() {
    if (!token) return;
    if (!ready) {
      setError('Choose your home country and passport nationality to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/preferences', {
        token,
        method: 'PUT',
        body: {
          home_country: countries.home_country?.code,
          residency_country: countries.residency_country?.code,
          passport_nationality: countries.passport_nationality?.code,
          trip_type: tripType ?? undefined,
          pace: pace ?? undefined,
          climate: climate ?? undefined,
          provider_priority: priority ?? undefined,
          available_time: availableTime.trim().slice(0, 32) || undefined,
        },
      });
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    markOnboardingSkipped();
    router.replace('/(tabs)');
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'About you', headerBackVisible: false, gestureEnabled: false }} />
      <Muted>A few answers help Travel OS suggest the right places, providers and visa notes. You can change them any time.</Muted>

      {(Object.keys(countryLabels) as CountryTarget[]).map((target) => (
        <View key={target} style={{ gap: 8 }}>
          <Text style={styles.label}>{countryLabels[target]}</Text>
          <Pressable style={styles.picker} onPress={() => setPicking(target)}>
            <Text style={countries[target] ? styles.pickerValue : styles.placeholder}>
              {countries[target] ? `${countries[target]!.name} · ${countries[target]!.code}` : 'Choose a country'}
            </Text>
          </Pressable>
        </View>
      ))}

      <Pills label="What kind of travel" options={tripTypes} value={tripType} onChange={setTripType} />
      <Pills label="Pace" options={paces} value={pace} onChange={setPace} />
      <Pills label="Climate" options={climates} value={climate} onChange={setClimate} />
      <Pills label="Prefer providers from" options={priorities} value={priority} onChange={setPriority} />
      <Field label="Time available" value={availableTime} onChangeText={setAvailableTime} placeholder="2 weeks, a long weekend…" />

      <ErrorNote message={error} />
      <Button label="Save and continue" onPress={save} busy={busy} />
      {!ready ? <Muted>Home country and passport nationality are needed to finish.</Muted> : null}
      <Button label="Skip for now" tone="quiet" onPress={skip} />

      <Modal visible={picking !== null} animationType="slide" onRequestClose={() => setPicking(null)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{picking ? countryLabels[picking] : ''}</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor="#a3988b"
            style={styles.search}
            autoCapitalize="none"
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={styles.country}
                onPress={() => {
                  if (picking) setCountries((current) => ({ ...current, [picking]: item }));
                  setPicking(null);
                  setQuery('');
                }}>
                <Text style={styles.pickerValue}>{item.name}</Text>
                <Text style={styles.placeholder}>{item.code}</Text>
              </Pressable>
            )}
          />
          <Button label="Close" tone="quiet" onPress={() => setPicking(null)} />
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
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pills}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(selected ? null : option)}
              style={[styles.pill, selected && styles.pillOn]}>
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
