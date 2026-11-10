from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Booking,
    BookingCategory,
    BookingStatus,
    ItineraryItem,
    ItineraryKind,
    ItineraryStatus,
    Journey,
    Stay,
)

_CATEGORY_KIND = {
    BookingCategory.flight: ItineraryKind.flight,
    BookingCategory.accommodation: ItineraryKind.accommodation,
    BookingCategory.activity: ItineraryKind.activity,
    BookingCategory.restaurant: ItineraryKind.restaurant,
    BookingCategory.train: ItineraryKind.transport,
    BookingCategory.bus: ItineraryKind.transport,
    BookingCategory.car_rental: ItineraryKind.transport,
    BookingCategory.transfer: ItineraryKind.transport,
    BookingCategory.cruise: ItineraryKind.transport,
    BookingCategory.insurance: ItineraryKind.reminder,
    BookingCategory.other: ItineraryKind.activity,
}

_STATUS = {
    BookingStatus.confirmed: ItineraryStatus.confirmed,
    BookingStatus.modified: ItineraryStatus.confirmed,
    BookingStatus.planned: ItineraryStatus.planned,
    BookingStatus.completed: ItineraryStatus.completed,
}


def sync_booking_itinerary(session: Session, booking: Booking) -> ItineraryItem | None:
    item = session.scalar(select(ItineraryItem).where(ItineraryItem.booking_id == booking.id))
    if booking.status == BookingStatus.cancelled:
        if item is not None:
            session.delete(item)
        return None
    if item is None:
        item = ItineraryItem(
            user_id=booking.user_id,
            booking_id=booking.id,
            kind=_CATEGORY_KIND[booking.category],
            status=_STATUS[booking.status],
            title=_booking_title(booking),
        )
        session.add(item)
    item.user_id = booking.user_id
    item.travel_space_id = booking.travel_space_id
    item.kind = _CATEGORY_KIND[booking.category]
    item.status = _STATUS[booking.status]
    item.title = _booking_title(booking)
    item.starts_at = booking.starts_at
    item.ends_at = booking.ends_at
    item.starts_on = _as_date(booking.starts_at)
    item.ends_on = _as_date(booking.ends_at)
    item.timezone = booking.timezone
    item.location_label = booking.location_label
    item.latitude = booking.latitude
    item.longitude = booking.longitude
    return item


def sync_stay_itinerary(session: Session, stay: Stay) -> ItineraryItem:
    item = session.scalar(select(ItineraryItem).where(ItineraryItem.stay_id == stay.id))
    if item is None:
        item = ItineraryItem(
            user_id=stay.user_id,
            stay_id=stay.id,
            kind=ItineraryKind.stay,
            status=ItineraryStatus.planned,
            title=f"Stay: {stay.title}",
        )
        session.add(item)
    item.travel_space_id = stay.travel_space_id
    item.title = f"Stay: {stay.title}"
    item.starts_on = stay.start_date
    item.ends_on = stay.end_date
    item.location_label = stay.title
    return item


def sync_journey_itinerary(session: Session, journey: Journey) -> ItineraryItem:
    item = session.scalar(select(ItineraryItem).where(ItineraryItem.journey_id == journey.id))
    if item is None:
        item = ItineraryItem(
            user_id=journey.user_id,
            journey_id=journey.id,
            kind=ItineraryKind.journey,
            status=ItineraryStatus.planned,
            title=f"{journey.origin_label} → {journey.destination_label}",
        )
        session.add(item)
    item.travel_space_id = journey.travel_space_id
    item.title = f"{journey.origin_label} → {journey.destination_label}"
    item.starts_on = journey.depart_on
    item.ends_on = journey.arrive_on
    item.location_label = journey.destination_label
    return item


def _booking_title(booking: Booking) -> str:
    details = booking.details or {}
    title = details.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    label = booking.location_label or booking.provider
    pretty = booking.category.value.replace("_", " ").title()
    return f"{pretty}: {label}"


def _as_date(value: datetime | None) -> date | None:
    if value is None:
        return None
    return value.date()
