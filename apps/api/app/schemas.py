import json
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import (
    BookingCategory,
    BookingSourceKind,
    BookingStatus,
    ItineraryKind,
    ItineraryStatus,
    SavedPlaceStatus,
    TravelSpaceKind,
    TravelSpaceStatus,
)


class DevLoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=120)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    home_base: str | None


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    home_base: str | None = Field(default=None, max_length=160)


class PreferenceIn(BaseModel):
    home_currency: str = "USD"
    locale: str = "en"
    timezone: str = "UTC"
    budget_level: str | None = None
    travel_style: str | None = None
    interests: list[str] = Field(default_factory=list)
    food_preferences: list[str] = Field(default_factory=list)
    accommodation_preferences: list[str] = Field(default_factory=list)
    accessibility_notes: str | None = None
    notifications_enabled: bool = True


class PreferenceOut(PreferenceIn):
    model_config = ConfigDict(from_attributes=True)


class TravelSpaceIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: TravelSpaceKind = TravelSpaceKind.holiday
    status: TravelSpaceStatus = TravelSpaceStatus.planning
    start_date: date | None = None
    end_date: date | None = None
    destination_name: str | None = Field(default=None, max_length=160)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    summary: str | None = None


class TravelSpacePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    kind: TravelSpaceKind | None = None
    status: TravelSpaceStatus | None = None
    start_date: date | None = None
    end_date: date | None = None
    destination_name: str | None = Field(default=None, max_length=160)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    summary: str | None = None


class MergeIn(BaseModel):
    from_space_id: UUID


class TravelSpaceOut(BaseModel):
    id: UUID
    title: str
    kind: TravelSpaceKind
    status: TravelSpaceStatus
    start_date: date | None
    end_date: date | None
    destination_name: str | None
    country_code: str | None = None
    summary: str | None


class StayIn(BaseModel):
    travel_space_id: UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    accommodation_type: str | None = Field(default=None, max_length=64)
    destination_name: str | None = Field(default=None, max_length=160)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None


class StayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    travel_space_id: UUID | None
    title: str
    accommodation_type: str | None
    start_date: date | None
    end_date: date | None
    notes: str | None


class JourneyIn(BaseModel):
    travel_space_id: UUID | None = None
    origin_label: str = Field(min_length=1, max_length=200)
    destination_label: str = Field(min_length=1, max_length=200)
    mode: str = Field(default="other", max_length=32)
    depart_on: date | None = None
    arrive_on: date | None = None
    notes: str | None = None


class JourneyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    travel_space_id: UUID | None
    origin_label: str
    destination_label: str
    mode: str
    depart_on: date | None
    arrive_on: date | None
    notes: str | None


class DestinationIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: str = "city"
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    latitude: float | None = None
    longitude: float | None = None


class DestinationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    kind: str
    country_code: str | None
    latitude: float | None
    longitude: float | None


class SavedPlaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="place", max_length=64)
    address: str | None = Field(default=None, max_length=300)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    latitude: float | None = None
    longitude: float | None = None
    travel_space_id: UUID | None = None
    status: SavedPlaceStatus = SavedPlaceStatus.saved
    notes: str | None = None
    destination_name: str | None = None


class CoordinatesIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class SavedPlaceStatusIn(BaseModel):
    status: SavedPlaceStatus


class SavedPlaceOut(BaseModel):
    id: UUID
    name: str
    category: str
    address: str | None
    latitude: float | None
    longitude: float | None
    travel_space_id: UUID | None
    status: SavedPlaceStatus
    notes: str | None


class BookingIn(BaseModel):
    travel_space_id: UUID | None = None
    category: BookingCategory
    provider: str = Field(min_length=1, max_length=160)
    confirmation_reference: str | None = Field(default=None, max_length=64)
    status: BookingStatus = BookingStatus.confirmed
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    timezone: str | None = None
    location_label: str | None = Field(default=None, max_length=240)
    latitude: float | None = None
    longitude: float | None = None
    price_amount: Decimal | None = None
    price_currency: str | None = None
    cancellation_policy: str | None = None
    notes: str | None = None
    details: dict | None = None


class BookingPatch(BaseModel):
    """Partial update: only the fields sent are changed."""

    travel_space_id: UUID | None = None
    category: BookingCategory | None = None
    provider: str | None = Field(default=None, min_length=1, max_length=160)
    confirmation_reference: str | None = Field(default=None, max_length=64)
    status: BookingStatus | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    timezone: str | None = None
    location_label: str | None = Field(default=None, max_length=240)
    latitude: float | None = None
    longitude: float | None = None
    price_amount: Decimal | None = None
    price_currency: str | None = None
    cancellation_policy: str | None = None
    notes: str | None = None
    details: dict | None = None


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    travel_space_id: UUID | None
    category: BookingCategory
    provider: str
    confirmation_reference: str | None
    status: BookingStatus
    source: BookingSourceKind
    starts_at: datetime | None
    ends_at: datetime | None
    timezone: str | None
    location_label: str | None
    latitude: float | None
    longitude: float | None
    price_amount: Decimal | None
    price_currency: str | None
    cancellation_policy: str | None
    notes: str | None
    details: dict | None


class BookingSourceOut(BaseModel):
    """Where a booking's details came from, with a link back to the original."""

    kind: str
    subject: str
    received_at: datetime | None
    url: str | None


class BookingDetailOut(BookingOut):
    sources: list[BookingSourceOut] = []


class NightOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    date: date
    status: str
    title: str | None = None
    booking_id: UUID | None = None
    stay_id: UUID | None = None
    night_index: int | None = None
    night_count: int | None = None


class GapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    start: date
    end: date
    nights: int


class MoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    date: date
    from_title: str
    to_title: str
    has_transport: bool


class StayCoverageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    nights: list[NightOut]
    gaps: list[GapOut]
    moves: list[MoveOut] = []
    total_nights: int
    covered_nights: int


class ItineraryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    booking_id: UUID | None = None
    stay_id: UUID | None = None
    journey_id: UUID | None = None
    travel_space_id: UUID | None
    kind: ItineraryKind
    status: ItineraryStatus
    title: str
    starts_on: date | None
    ends_on: date | None
    starts_at: datetime | None
    ends_at: datetime | None
    timezone: str | None
    location_label: str | None
    latitude: float | None
    longitude: float | None


class FocusOut(BaseModel):
    key: str
    label: str
    available: bool


class DashboardOut(BaseModel):
    mode: str
    headline: str
    travel_space: TravelSpaceOut | None
    focus: list[FocusOut]
    today: list[ItineraryOut]
    # Counted facts for the adaptive home (see services/dashboard_situation.py).
    situation: dict = {}


class EmailIn(BaseModel):
    external_id: str = Field(min_length=1, max_length=255)
    subject: str = ""
    body: str = ""
    received_at: datetime | None = None


class IngestOut(BaseModel):
    status: str
    classification: str
    booking_id: UUID | None
    detail: str


class IntegrationOut(BaseModel):
    provider: str
    status: str
    scopes: list[str]
    last_synced_at: datetime | None


class ConnectIn(BaseModel):
    return_to: str | None = None


class ConnectOut(BaseModel):
    authorization_url: str


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    kind: str
    title: str
    body: str
    read_at: datetime | None
    created_at: datetime


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    travel_space_id: UUID | None = None
    conversation_id: UUID | None = None


class ActionProposal(BaseModel):
    """A change the companion will write only after the traveller confirms."""

    kind: str
    title: str
    travel_space_id: UUID
    start_date: date | None = None
    end_date: date | None = None
    starts_on: date | None = None


class PlanIn(BaseModel):
    travel_space_id: UUID
    title: str = Field(min_length=1, max_length=200)
    starts_on: date
    location_label: str | None = Field(default=None, max_length=240)


class ChatOut(BaseModel):
    conversation_id: UUID
    reply: str
    used_model: bool
    proposal: ActionProposal | None = None


class ForwardingOut(BaseModel):
    address: str | None
    available: bool


class InboundMailIn(BaseModel):
    to: str = Field(min_length=3, max_length=320)
    subject: str = Field(default="", max_length=500)
    text: str = Field(default="", max_length=200_000)


class PromptDismissIn(BaseModel):
    kind: str = Field(pattern="^(gap|move)$")
    key: str = Field(min_length=10, max_length=32)


class PushTokenIn(BaseModel):
    token: str = Field(min_length=8, max_length=255)
    platform: str = Field(default="ios", max_length=16)


class ReminderOut(BaseModel):
    kind: str
    title: str
    body: str
    when: date


class ItineraryViewOut(BaseModel):
    view: str
    items: list[ItineraryOut] = Field(default_factory=list)
    days: dict[str, list[ItineraryOut]] | None = None
    located: list[ItineraryOut] | None = None
    unlocated: list[ItineraryOut] | None = None


class SavedListingIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=500)
    category: str = Field(default="accommodation", max_length=64)
    travel_space_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=500)


class SavedListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    url: str
    category: str
    travel_space_id: UUID | None
    notes: str | None


class ListingOpenOut(BaseModel):
    url: str
    disclosure: str = "This opens the provider. Travel OS does not make the booking."


class InventoryOut(BaseModel):
    providers: list[str]
    listings: list[dict]


def reject_large_details(details: dict | None) -> None:
    if details is not None and len(json.dumps(details)) > 20_000:
        from app.core.errors import AppError

        raise AppError(422, "Booking details are too large.")
