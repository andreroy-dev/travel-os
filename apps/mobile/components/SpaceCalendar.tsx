import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Muted, theme } from '@/components/ui';
import { addDays } from '@/lib/dates';
import type { ItineraryItem, StayCoverage } from '@/lib/types';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const heads = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const tone: Record<string, { bg: string; fg: string }> = {
  booked: { bg: theme.moss, fg: '#fff' },
  own_stay: { bg: '#5aa58b', fg: '#fff' },
  transit: { bg: '#3d6f9e', fg: '#fff' },
  gap: { bg: theme.coralSoft, fg: theme.danger },
  last: { bg: theme.mossSoft, fg: theme.ink },
};

function monthsBetween(start: string, end: string): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  while (y * 12 + m <= endKey && out.length < 24) {
    out.push({ y, m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Month grid for a Travel Space: each night coloured by where you sleep, dots for plans. */
export function SpaceCalendar({
  start,
  end,
  items,
  coverage,
  onPickDay,
}: {
  start: string;
  end: string;
  items: ItineraryItem[];
  coverage: StayCoverage | null;
  onPickDay: (day: string) => void;
}) {
  const nightStatus = new Map((coverage?.nights ?? []).map((night) => [night.date, night.status]));
  const plans = new Map<string, number>();
  for (const item of items) {
    if (item.starts_on && item.kind !== 'stay') plans.set(item.starts_on, (plans.get(item.starts_on) ?? 0) + 1);
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.legend}>
        {[
          ['booked', 'Booked'],
          ['own_stay', 'Your own stay'],
          ['transit', 'Overnight travel'],
          ['gap', 'No place yet'],
        ].map(([key, label]) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: tone[key].bg }]} />
            <Muted>{label}</Muted>
          </View>
        ))}
      </View>
      {monthsBetween(start, end).map(({ y, m }) => {
        const first = `${y}-${String(m).padStart(2, '0')}-01`;
        const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
        const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const cells: (string | null)[] = [...Array(lead).fill(null)];
        for (let d = 0; d < length; d += 1) cells.push(addDays(first, d));
        while (cells.length % 7) cells.push(null);
        return (
          <View key={first} style={styles.month}>
            <Text style={styles.monthTitle}>
              {monthNames[m - 1]} {y}
            </Text>
            <View style={styles.week}>
              {heads.map((head, index) => (
                <Text key={`${head}-${index}`} style={styles.head}>
                  {head}
                </Text>
              ))}
            </View>
            {Array.from({ length: cells.length / 7 }, (_, row) => (
              <View key={row} style={styles.week}>
                {cells.slice(row * 7, row * 7 + 7).map((day, index) => {
                  if (!day) return <View key={`blank-${row}-${index}`} style={styles.cell} />;
                  const inTrip = day >= start && day <= end;
                  const status = day === end ? 'last' : nightStatus.get(day);
                  const colours = inTrip && status ? tone[status] : null;
                  const count = plans.get(day) ?? 0;
                  return (
                    <Pressable
                      key={day}
                      disabled={!inTrip}
                      onPress={() => onPickDay(day)}
                      style={[styles.cell, colours && { backgroundColor: colours.bg }, !inTrip && styles.outside]}>
                      <Text style={[styles.dayNum, colours && { color: colours.fg }]}>{Number(day.slice(8, 10))}</Text>
                      {count > 0 ? <View style={[styles.dot, colours && { backgroundColor: colours.fg }]} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}
      <Muted>Tap a day to open it in the itinerary. A dot means something is planned that day.</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  month: { backgroundColor: '#fff', borderRadius: 18, padding: 12, gap: 4 },
  monthTitle: { color: theme.ink, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  week: { flexDirection: 'row', gap: 4 },
  head: { flex: 1, textAlign: 'center', color: theme.muted, fontSize: 12, fontWeight: '600' },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outside: { opacity: 0.35 },
  dayNum: { color: theme.ink, fontWeight: '600' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.moss, marginTop: 2 },
});
