"""Read models for the long-stay module. Writes stay in the route layer."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.living import CostCategory, ServiceCategory, VisaRule


class MoneyIn(BaseModel):
    travel_space_id: UUID
    name: str = Field(min_length=1, max_length=200)
    category: CostCategory = CostCategory.other
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    spent_on: date | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    split_with: list[str] = []


class BudgetIn(BaseModel):
    travel_space_id: UUID
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)


class ServiceIn(BaseModel):
    travel_space_id: UUID
    name: str = Field(min_length=1, max_length=200)
    category: ServiceCategory = ServiceCategory.other
    address: str | None = Field(default=None, max_length=300)
    notes: str | None = None


class NeighbourhoodIn(BaseModel):
    travel_space_id: UUID
    name: str = Field(min_length=1, max_length=200)
    accommodation_note: str | None = None
    transport_note: str | None = None
    distance_note: str | None = None
    amenities_note: str | None = None
    safety_note: str | None = None
    safety_source: str | None = Field(default=None, max_length=300)


class EventIn(BaseModel):
    travel_space_id: UUID
    title: str = Field(min_length=1, max_length=200)
    starts_on: date
    place_label: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=500)


class VisaLogIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    rule: VisaRule
    allowed_days: int | None = Field(default=None, ge=1, le=3660)


class VisaSpanIn(BaseModel):
    entered_on: date
    exited_on: date | None = None


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str | None = None
    title: str | None = None
    category: str | None = None
    amount: Decimal | None = None
    currency: str | None = None
    spent_on: date | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    address: str | None = None
    notes: str | None = None
    accommodation_note: str | None = None
    transport_note: str | None = None
    distance_note: str | None = None
    amenities_note: str | None = None
    safety_note: str | None = None
    safety_source: str | None = None
    place_label: str | None = None
    source_url: str | None = None
    label: str | None = None
    country_code: str | None = None
    rule: str | None = None
    allowed_days: int | None = None
    year: int | None = None
    month: int | None = None
    entered_on: date | None = None
    exited_on: date | None = None
    splits: list[dict] = []
