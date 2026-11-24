import type { Booking } from '@/lib/types';

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The booking that matters right now in a category: the one in progress today,
 * else the next one coming up, else the most recent one. Cancelled bookings are ignored.
 * Every screen uses this, so "your stay" means the same hotel everywhere.
 */
export function currentBooking(bookings: Booking[], category: string, today = localToday()): Booking | null {
  const rows = bookings
    .filter((b) => b.category === category && b.status !== 'cancelled' && b.starts_at)
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
  if (rows.length === 0) return null;
  const now = rows.find((b) => b.starts_at!.slice(0, 10) <= today && (b.ends_at ?? b.starts_at)!.slice(0, 10) > today);
  if (now) return now;
  const next = rows.find((b) => b.starts_at!.slice(0, 10) >= today);
  return next ?? rows[rows.length - 1];
}

export const categoryNames: Record<string, { one: string; many: string }> = {
  flight: { one: 'Flight', many: 'Flights' },
  accommodation: { one: 'Stay', many: 'Stays' },
  train: { one: 'Train', many: 'Trains' },
  bus: { one: 'Bus', many: 'Buses' },
  activity: { one: 'Activity', many: 'Activities' },
  car_rental: { one: 'Car rental', many: 'Car rentals' },
  transfer: { one: 'Transfer', many: 'Transfers' },
  restaurant: { one: 'Restaurant', many: 'Restaurants' },
  cruise: { one: 'Cruise', many: 'Cruises' },
  insurance: { one: 'Insurance', many: 'Insurance' },
  other: { one: 'Booking', many: 'Other bookings' },
};
