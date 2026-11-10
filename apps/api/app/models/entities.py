import enum
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


def enum_column(enum_cls: type[enum.Enum], length: int = 32):
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda members: [member.value for member in members],
    )


class TravelSpaceKind(str, enum.Enum):
    holiday = "holiday"
    long_stay = "long_stay"
    relocation = "relocation"
    open_ended = "open_ended"
    business = "business"
    other = "other"


class TravelSpaceStatus(str, enum.Enum):
    planning = "planning"
    upcoming = "upcoming"
    active = "active"
    paused = "paused"
    completed = "completed"
    archived = "archived"


class DestinationKind(str, enum.Enum):
    country = "country"
    region = "region"
    city = "city"
    neighbourhood = "neighbourhood"


class BookingCategory(str, enum.Enum):
    flight = "flight"
    accommodation = "accommodation"
    activity = "activity"
    restaurant = "restaurant"
    car_rental = "car_rental"
    train = "train"
    bus = "bus"
    transfer = "transfer"
    cruise = "cruise"
    insurance = "insurance"
    other = "other"


class BookingStatus(str, enum.Enum):
    confirmed = "confirmed"
    modified = "modified"
    cancelled = "cancelled"
    completed = "completed"
    planned = "planned"


class BookingSourceKind(str, enum.Enum):
    manual = "manual"
    gmail = "gmail"
    upload = "upload"
    screenshot = "screenshot"
    forward = "forward"


class ItineraryKind(str, enum.Enum):
    flight = "flight"
    accommodation = "accommodation"
    activity = "activity"
    transport = "transport"
    destination = "destination"
    restaurant = "restaurant"
    reminder = "reminder"
    stay = "stay"
    journey = "journey"


class ItineraryStatus(str, enum.Enum):
    planned = "planned"
    confirmed = "confirmed"
    completed = "completed"


class IntegrationProvider(str, enum.Enum):
    gmail = "gmail"


class IntegrationStatus(str, enum.Enum):
    pending = "pending"
    connected = "connected"
    error = "error"
    disconnected = "disconnected"


class EmailClassification(str, enum.Enum):
    confirmation = "confirmation"
    modification = "modification"
    cancellation = "cancellation"
    needs_review = "needs_review"
    ignored = "ignored"


class SavedPlaceStatus(str, enum.Enum):
    saved = "saved"
    considering = "considering"
    visited = "visited"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    home_base: Mapped[str | None] = mapped_column(String(160))
    supabase_user_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    preference: Mapped["UserPreference | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    home_currency: Mapped[str] = mapped_column(String(3), default="USD")
    locale: Mapped[str] = mapped_column(String(16), default="en")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    budget_level: Mapped[str | None] = mapped_column(String(32))
    travel_style: Mapped[str | None] = mapped_column(String(64))
    interests: Mapped[list] = mapped_column(JSON, default=list)
    food_preferences: Mapped[list] = mapped_column(JSON, default=list)
    accommodation_preferences: Mapped[list] = mapped_column(JSON, default=list)
    accessibility_notes: Mapped[str | None] = mapped_column(Text)
    notifications_enabled: Mapped[bool] = mapped_column(default=True)

    user: Mapped[User] = relationship(back_populates="preference")


class Destination(Base):
    __tablename__ = "destinations"
    __table_args__ = (
        UniqueConstraint("name", "country_code", "kind", name="uq_destinations_identity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    kind: Mapped[DestinationKind] = mapped_column(enum_column(DestinationKind))
    name: Mapped[str] = mapped_column(String(160), index=True)
    country_code: Mapped[str | None] = mapped_column(String(2))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("destinations.id", ondelete="SET NULL")
    )
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TravelSpace(Base):
    __tablename__ = "travel_spaces"
    __table_args__ = (Index("ix_travel_spaces_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[TravelSpaceKind] = mapped_column(
        enum_column(TravelSpaceKind), default=TravelSpaceKind.holiday
    )
    status: Mapped[TravelSpaceStatus] = mapped_column(
        enum_column(TravelSpaceStatus), default=TravelSpaceStatus.planning
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    destination_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("destinations.id", ondelete="SET NULL")
    )
    summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    destination: Mapped[Destination | None] = relationship()


class Stay(Base):
    __tablename__ = "stays"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    travel_space_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    accommodation_type: Mapped[str | None] = mapped_column(String(64))
    destination_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("destinations.id", ondelete="SET NULL")
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Journey(Base):
    __tablename__ = "journeys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    travel_space_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="SET NULL"), index=True
    )
    origin_label: Mapped[str] = mapped_column(String(200))
    destination_label: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(32), default="other")
    depart_on: Mapped[date | None] = mapped_column(Date)
    arrive_on: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    destination_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("destinations.id", ondelete="SET NULL")
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(64), default="place")
    address: Mapped[str | None] = mapped_column(String(300))
    country_code: Mapped[str | None] = mapped_column(String(2))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedPlace(Base):
    __tablename__ = "saved_places"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "location_id", "travel_space_id", name="uq_saved_places_target"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("locations.id", ondelete="CASCADE")
    )
    travel_space_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="SET NULL")
    )
    status: Mapped[SavedPlaceStatus] = mapped_column(
        enum_column(SavedPlaceStatus), default=SavedPlaceStatus.saved
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    location: Mapped[Location] = relationship()


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (Index("ix_bookings_user_starts", "user_id", "starts_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    travel_space_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="SET NULL"), index=True
    )
    category: Mapped[BookingCategory] = mapped_column(enum_column(BookingCategory))
    provider: Mapped[str] = mapped_column(String(160))
    confirmation_reference: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[BookingStatus] = mapped_column(
        enum_column(BookingStatus), default=BookingStatus.confirmed
    )
    source: Mapped[BookingSourceKind] = mapped_column(
        enum_column(BookingSourceKind), default=BookingSourceKind.manual
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str | None] = mapped_column(String(64))
    location_label: Mapped[str | None] = mapped_column(String(240))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    price_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    price_currency: Mapped[str | None] = mapped_column(String(3))
    cancellation_policy: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EmailRecord(Base):
    """Processing record for an inbound message. Body text is not retained."""

    __tablename__ = "emails"
    __table_args__ = (UniqueConstraint("user_id", "external_id", name="uq_emails_user_external"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    integration_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("integrations.id", ondelete="SET NULL")
    )
    external_id: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500), default="")
    classification: Mapped[EmailClassification] = mapped_column(enum_column(EmailClassification))
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("bookings.id", ondelete="SET NULL")
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_integrations_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[IntegrationProvider] = mapped_column(enum_column(IntegrationProvider))
    status: Mapped[IntegrationStatus] = mapped_column(
        enum_column(IntegrationStatus), default=IntegrationStatus.pending
    )
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    token_ciphertext: Mapped[str | None] = mapped_column(Text)
    external_account: Mapped[str | None] = mapped_column(String(320))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ItineraryItem(Base):
    __tablename__ = "itinerary_items"
    __table_args__ = (Index("ix_itinerary_user_starts", "user_id", "starts_on"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    travel_space_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="SET NULL"), index=True
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("bookings.id", ondelete="CASCADE"), unique=True
    )
    stay_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("stays.id", ondelete="CASCADE"), unique=True
    )
    journey_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("journeys.id", ondelete="CASCADE"), unique=True
    )
    kind: Mapped[ItineraryKind] = mapped_column(enum_column(ItineraryKind))
    status: Mapped[ItineraryStatus] = mapped_column(enum_column(ItineraryStatus))
    title: Mapped[str] = mapped_column(String(240))
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str | None] = mapped_column(String(64))
    location_label: Mapped[str | None] = mapped_column(String(240))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=func.now()
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    travel_space_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiUsage(Base):
    __tablename__ = "ai_usages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    model: Mapped[str] = mapped_column(String(80))
    prompt_tokens: Mapped[int] = mapped_column(default=0)
    completion_tokens: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
