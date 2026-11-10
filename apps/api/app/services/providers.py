"""Provider adapters normalize external inventory.

Release 1 does not ship a provider. Search returns an empty list rather than
invented prices or availability. Later adapters implement this protocol and
register themselves; the rest of the app never sees a provider's raw payload.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class ListingQuery:
    category: str
    query: str
    start_date: date | None = None
    end_date: date | None = None


@dataclass(frozen=True)
class NormalizedListing:
    provider: str
    external_id: str
    name: str
    category: str
    description: str | None
    latitude: float | None
    longitude: float | None
    price_amount: Decimal | None
    price_currency: str | None
    rating: float | None
    rating_source: str | None
    booking_url: str | None
    availability: str
    last_updated: datetime


class ProviderAdapter(Protocol):
    name: str

    def search(self, query: ListingQuery) -> list[NormalizedListing]: ...


class ProviderRegistry:
    def __init__(self) -> None:
        self._adapters: list[ProviderAdapter] = []

    def register(self, adapter: ProviderAdapter) -> None:
        self._adapters.append(adapter)

    def search(self, query: ListingQuery) -> list[NormalizedListing]:
        listings: list[NormalizedListing] = []
        for adapter in self._adapters:
            listings.extend(adapter.search(query))
        return listings

    def names(self) -> list[str]:
        return [adapter.name for adapter in self._adapters]


registry = ProviderRegistry()
