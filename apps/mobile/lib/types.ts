export type User = {
  id: string;
  email: string;
  display_name: string;
  home_base: string | null;
};

export type Preferences = {
  home_currency: string;
  locale: string;
  timezone: string;
  budget_level: string | null;
  travel_style: string | null;
  interests: string[];
  food_preferences: string[];
  accommodation_preferences: string[];
  accessibility_notes: string | null;
  notifications_enabled: boolean;
};

export type TravelSpace = {
  id: string;
  title: string;
  kind: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  destination_name: string | null;
  country_code?: string | null;
  summary: string | null;
};

export type Stay = {
  id: string;
  travel_space_id: string | null;
  title: string;
  accommodation_type: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
};

export type Booking = {
  id: string;
  travel_space_id: string | null;
  category: string;
  provider: string;
  confirmation_reference: string | null;
  status: string;
  source: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  location_label: string | null;
  price_amount: string | null;
  price_currency: string | null;
  cancellation_policy: string | null;
  notes: string | null;
  details: {
    segments?: {
      flight_number?: string;
      airline?: string;
      origin?: string;
      destination?: string;
      origin_code?: string;
      destination_code?: string;
      departure_time?: string;
      arrival_time?: string;
      departure_terminal?: string;
      arrival_terminal?: string;
      cabin?: string;
      pnr?: string;
    }[];
    [key: string]: string | number | undefined | object;
  } | null;
};

export type ItineraryItem = {
  id: string;
  booking_id: string | null;
  stay_id?: string | null;
  journey_id?: string | null;
  travel_space_id: string | null;
  kind: string;
  status: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  timezone: string | null;
  location_label: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ItineraryView = {
  view: string;
  items: ItineraryItem[];
  days: Record<string, ItineraryItem[]> | null;
  located: ItineraryItem[] | null;
  unlocated: ItineraryItem[] | null;
};

export type Dashboard = {
  mode: string;
  headline: string;
  travel_space: TravelSpace | null;
  focus: { key: string; label: string; available: boolean }[];
  today: ItineraryItem[];
  situation?: Situation;
};

/** Counted facts for the adaptive home. Every field is optional; the mode decides which are shown. */
export type Situation = {
  upcoming?: { id: string; title: string; status: string; start_date: string | null; end_date: string | null; days_until: number | null }[];
  trips_completed?: number;
  visa?: { label: string; remaining_days: number; limit_days: number }[];
  days_until?: number | null;
  day_number?: number | null;
  total_days?: number | null;
  bookings?: { confirmed: number; planned: number };
  nights?: { covered: number; total: number; gaps: StayGap[] };
  tonight?: { status: string; title: string | null; night_index: number | null; night_count: number | null; booking_id: string | null };
  packing?: { total: number; packed: number };
  money?: { currency: string; combined: string; budget: string | null; remaining: string | null }[];
  photos?: number;
  places?: Record<string, number>;
};

export type SavedPlace = {
  id: string;
  name: string;
  category: string;
  address: string | null;
  travel_space_id: string | null;
  status: string;
  notes: string | null;
};

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type GmailAccount = {
  id: string;
  email: string | null;
  /** connected, or error when Google stopped allowing access and it needs reconnecting. */
  status: string;
  last_synced_at: string | null;
};

export type Integration = {
  provider: string;
  status: string;
  scopes: string[];
  last_synced_at: string | null;
  accounts: GmailAccount[];
};

export type IngestResult = {
  status: string;
  classification: string;
  booking_id: string | null;
  detail: string;
};

export type BookingSource = {
  kind: string;
  subject: string;
  received_at: string | null;
  url: string | null;
};

export type BookingDetail = Booking & { sources: BookingSource[] };

export type CoverageNight = {
  date: string;
  status: 'booked' | 'own_stay' | 'transit' | 'gap';
  title: string | null;
  booking_id: string | null;
  stay_id: string | null;
  night_index: number | null;
  night_count: number | null;
};

export type StayGap = { start: string; end: string; nights: number };

export type StayMove = { date: string; from_title: string; to_title: string; has_transport: boolean };

export type StayCoverage = {
  nights: CoverageNight[];
  gaps: StayGap[];
  moves: StayMove[];
  total_nights: number;
  covered_nights: number;
};
