"""Long-stay records. Amounts and day counts are stored as entered; nothing here is estimated."""

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import enum_column


class CostCategory(str, enum.Enum):
    rent = "rent"
    deposit = "deposit"
    utilities = "utilities"
    groceries = "groceries"
    transport = "transport"
    fitness = "fitness"
    entertainment = "entertainment"
    other = "other"


class ServiceCategory(str, enum.Enum):
    gym = "gym"
    coworking = "coworking"
    grocery = "grocery"
    cafe = "cafe"
    healthcare = "healthcare"
    pharmacy = "pharmacy"
    laundry = "laundry"
    library = "library"
    transport = "transport"
    community = "community"
    other = "other"


class VisaRule(str, enum.Enum):
    countdown = "countdown"
    schengen_90_180 = "schengen_90_180"


class RecurringCost(Base):
    __tablename__ = "recurring_costs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[CostCategory] = mapped_column(enum_column(CostCategory))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[CostCategory] = mapped_column(enum_column(CostCategory))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    spent_on: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expense_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MonthlyBudget(Base):
    __tablename__ = "monthly_budgets"
    __table_args__ = (
        UniqueConstraint("user_id", "travel_space_id", "year", "month", name="uq_monthly_budget"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    year: Mapped[int] = mapped_column()
    month: Mapped[int] = mapped_column()
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LocalService(Base):
    __tablename__ = "local_services"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[ServiceCategory] = mapped_column(enum_column(ServiceCategory))
    address: Mapped[str | None] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NeighbourhoodNote(Base):
    __tablename__ = "neighbourhood_notes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    accommodation_note: Mapped[str | None] = mapped_column(Text)
    transport_note: Mapped[str | None] = mapped_column(Text)
    distance_note: Mapped[str | None] = mapped_column(Text)
    amenities_note: Mapped[str | None] = mapped_column(Text)
    safety_note: Mapped[str | None] = mapped_column(Text)
    safety_source: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LocalEvent(Base):
    __tablename__ = "local_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    starts_on: Mapped[date] = mapped_column(Date)
    place_label: Mapped[str | None] = mapped_column(String(200))
    source_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VisaLog(Base):
    __tablename__ = "visa_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(120))
    country_code: Mapped[str | None] = mapped_column(String(2))
    rule: Mapped[VisaRule] = mapped_column(enum_column(VisaRule))
    allowed_days: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VisaSpan(Base):
    __tablename__ = "visa_spans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    visa_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("visa_logs.id", ondelete="CASCADE"), index=True
    )
    entered_on: Mapped[date] = mapped_column(Date)
    exited_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
