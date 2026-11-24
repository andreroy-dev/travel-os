import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/motion';
import { Sheet } from '@/components/Sheet';
import { Button, ErrorNote, Field, Muted, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { prettyDay } from '@/lib/dates';
import type { StayGap } from '@/lib/types';

type Links = { city: string; links: { provider: string; kind: string; url: string }[]; disclosure: string };

/** "Find a place to book" for an open gap: opens providers with the city and dates filled in. */
export function StaySearchSheet({
  spaceId,
  token,
  gap,
  defaultCity,
  onClose,
}: {
  spaceId: string;
  token: string;
  gap: StayGap | null;
  defaultCity: string;
  onClose: () => void;
}) {
  const [city, setCity] = useState(defaultCity);
  const [result, setResult] = useState<Links | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCity(defaultCity);
    setResult(null);
    setError(null);
  }, [gap, defaultCity]);

  async function search() {
    if (!gap) return;
    setBusy(true);
    setError(null);
    try {
      const query = `start=${gap.start}&end=${gap.end}${city.trim() ? `&city=${encodeURIComponent(city.trim())}` : ''}`;
      setResult(await api<Links>(`/travel-spaces/${spaceId}/stay-search?${query}`, { token }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the search.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={gap !== null} title="Find a place to book" onClose={onClose}>
      {gap ? (
        <Muted>
          {gap.nights} {gap.nights === 1 ? 'night' : 'nights'} · check in {prettyDay(gap.start)}, check out {prettyDay(gap.end)}
        </Muted>
      ) : null}
      <Field label="City" value={city} onChangeText={setCity} placeholder="Where do you want to stay?" />
      <Button label="Search providers" onPress={search} busy={busy} />
      <ErrorNote message={error} />
      {result ? (
        <View style={{ gap: 8 }}>
          {result.links.map((link) => (
            <PressableScale key={link.provider} onPress={() => void Linking.openURL(link.url)} style={styles.link}>
              <Text style={styles.provider}>{link.provider} ↗</Text>
              <Muted>{link.kind}</Muted>
            </PressableScale>
          ))}
          <Muted>{result.disclosure} Once you book, forward or import the confirmation and it fills this gap.</Muted>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  link: { backgroundColor: theme.mossSoft, borderRadius: 14, padding: 12, gap: 2 },
  provider: { color: theme.moss, fontWeight: '700', fontSize: 16 },
});
