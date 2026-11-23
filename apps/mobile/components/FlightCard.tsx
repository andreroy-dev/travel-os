import { StyleSheet, Text, View } from 'react-native';

import { Muted, theme } from '@/components/ui';
import { clock, duration, minutesBetween, prettyDate, weekday } from '@/lib/dates';
import type { Booking } from '@/lib/types';

type Segment = NonNullable<NonNullable<Booking['details']>['segments']>[number] & {
  departure_at?: string;
  arrival_at?: string;
};

/** Boarding-pass style view of a flight booking: one card per leg, layovers between. */
export function FlightCard({ booking, segments }: { booking: Booking; segments: Segment[] }) {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const pnr = segments.find((segment) => segment.pnr)?.pnr ?? booking.confirmation_reference;
  // Times are the local wall-clock times printed on the ticket, so durations
  // across airports would ignore time zones. Only same-airport layovers are computed.
  const stops = segments.length - 1;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.hero}>
        <Text style={styles.heroRoute}>
          {first.origin_code ?? first.origin} → {last.destination_code ?? last.destination}
        </Text>
        <Text style={styles.heroCities}>
          {first.origin} to {last.destination}
        </Text>
        <Text style={styles.heroMeta}>
          {[
            first.departure_at ? `${weekday(first.departure_at)} ${prettyDate(first.departure_at)}` : null,
            stops === 0 ? 'Direct' : `${stops} ${stops === 1 ? 'stop' : 'stops'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={styles.heroRow}>
          <View>
            <Text style={styles.heroLabel}>Booking ref</Text>
            <Text style={styles.heroValue}>{pnr ?? '—'}</Text>
          </View>
          <View>
            <Text style={styles.heroLabel}>Status</Text>
            <Text style={[styles.heroValue, { textTransform: 'capitalize' }]}>{booking.status}</Text>
          </View>
          <View>
            <Text style={styles.heroLabel}>Booked via</Text>
            <Text style={styles.heroValue}>{booking.provider}</Text>
          </View>
        </View>
      </View>

      {segments.map((segment, index) => {
        const next = segments[index + 1];
        const nextDay =
          segment.departure_at && segment.arrival_at && segment.arrival_at.slice(0, 10) > segment.departure_at.slice(0, 10);
        const layover =
          next && segment.arrival_at && next.departure_at ? duration(minutesBetween(segment.arrival_at, next.departure_at)) : '';
        return (
          <View key={`${segment.flight_number ?? 'leg'}-${index}`} style={{ gap: 10 }}>
            <View style={styles.leg}>
              <View style={styles.legHead}>
                <Text style={styles.legFlight}>{segment.flight_number ?? `Flight ${index + 1}`}</Text>
                <Muted>{[segment.airline, segment.cabin].filter(Boolean).join(' · ')}</Muted>
              </View>
              {segment.departure_at ? <Muted>{`${weekday(segment.departure_at)} ${prettyDate(segment.departure_at)}`}</Muted> : null}
              <View style={styles.legRow}>
                <View style={styles.end}>
                  <Text style={styles.time}>{clock(segment.departure_at) || segment.departure_time || '—'}</Text>
                  <Text style={styles.code}>{segment.origin_code ?? ''}</Text>
                  <Muted>{segment.origin ?? ''}</Muted>
                  {segment.departure_terminal ? <Muted>Terminal {segment.departure_terminal}</Muted> : null}
                </View>
                <View style={styles.mid}>
                  <View style={styles.line} />
                  <Text style={styles.plane}>✈︎</Text>
                </View>
                <View style={[styles.end, { alignItems: 'flex-end' }]}>
                  <Text style={styles.time}>
                    {clock(segment.arrival_at) || segment.arrival_time || '—'}
                    {nextDay ? <Text style={styles.plusDay}> +1</Text> : null}
                  </Text>
                  <Text style={styles.code}>{segment.destination_code ?? ''}</Text>
                  <Muted>{segment.destination ?? ''}</Muted>
                  {segment.arrival_terminal ? <Muted>Terminal {segment.arrival_terminal}</Muted> : null}
                </View>
              </View>
            </View>
            {next ? (
              <View style={styles.layover}>
                <Text style={styles.layoverText}>
                  Layover in {segment.destination ?? segment.destination_code}
                  {layover ? ` · ${layover}` : ''}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: theme.mossDeep, borderRadius: 22, padding: 18, gap: 4 },
  heroRoute: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  heroCities: { color: '#d7ebe3', fontSize: 16 },
  heroMeta: { color: '#d7ebe3' },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, gap: 8 },
  heroLabel: { color: '#a9cfc2', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroValue: { color: '#fff', fontSize: 16, fontWeight: '700' },
  leg: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 8, borderWidth: 1, borderColor: theme.line },
  legHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  legFlight: { color: theme.ink, fontSize: 16, fontWeight: '800' },
  legRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  end: { flex: 1, gap: 2 },
  time: { color: theme.ink, fontSize: 24, fontWeight: '800' },
  plusDay: { color: theme.clay, fontSize: 14, fontWeight: '700' },
  code: { color: theme.moss, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  mid: { width: 80, alignItems: 'center', paddingTop: 10, gap: 2 },
  line: { height: 1, alignSelf: 'stretch', backgroundColor: theme.line },
  plane: { color: theme.moss, fontSize: 16 },
  layover: { alignSelf: 'center', backgroundColor: theme.coralSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  layoverText: { color: theme.ink, fontWeight: '600' },
});
