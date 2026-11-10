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
  details: Record<string, string | number> | null;
};

export type ItineraryItem = {
  id: string;
  booking_id: string | null;
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

export type Integration = {
  provider: string;
  status: string;
  scopes: string[];
  last_synced_at: string | null;
};

export type IngestResult = {
  status: string;
  classification: string;
  booking_id: string | null;
  detail: string;
};
