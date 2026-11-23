const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(value: string) {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** Calendar-day arithmetic in UTC so device time zones never shift a date. */
export function addDays(value: string, by: number): string {
  const { y, m, d } = parts(value);
  const next = new Date(Date.UTC(y, m - 1, d + by));
  return next.toISOString().slice(0, 10);
}

export function nightsBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = parts(start);
  const b = parts(end);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function prettyDay(value: string | null | undefined): string {
  if (!value) return '';
  const { y, m, d } = parts(value);
  if (!y || !m || !d) return value;
  return `${d} ${months[m - 1]}`;
}

export function prettyDate(value: string | null | undefined): string {
  if (!value) return '';
  const { y, m, d } = parts(value);
  if (!y || !m || !d) return value.slice(0, 10);
  return `${d} ${months[m - 1]} ${y}`;
}

export function weekday(value: string): string {
  const { y, m, d } = parts(value);
  return weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "HH:MM" from an ISO timestamp, or '' for a date-only / midnight value. */
export function clock(value: string | null | undefined): string {
  if (!value || value.length < 16) return '';
  const time = value.slice(11, 16);
  return time === '00:00' ? '' : time;
}

export function minutesBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
}

export function duration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
