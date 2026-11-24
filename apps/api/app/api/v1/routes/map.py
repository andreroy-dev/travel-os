"""Map points taken only from coordinates already saved on a record."""

from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.models.entities import Booking, BookingCategory, BookingStatus, SavedPlace, TravelSpace
from app.models.memories import MemoryPhoto

router = APIRouter()

ROUTING_NOTE = "Routes and travel times are not connected. The map only shows coordinates already saved."


@router.get("/map/points")
def map_points(user: CurrentUser, session: DbSession, travel_space_id: UUID | None = None) -> dict:
    if travel_space_id is not None:
        owned(session, TravelSpace, travel_space_id, user.id)
    bookings = session.scalars(select(Booking).where(Booking.user_id == user.id)).all()
    places = session.scalars(
        select(SavedPlace).where(SavedPlace.user_id == user.id).options(selectinload(SavedPlace.location))
    ).all()
    photos = session.scalars(select(MemoryPhoto).where(MemoryPhoto.user_id == user.id)).all()
    points = []
    unlocated = []
    for booking in bookings:
        if travel_space_id is not None and booking.travel_space_id != travel_space_id:
            continue
        if booking.status == BookingStatus.cancelled:
            continue
        if booking.latitude is None or booking.longitude is None:
            query = _booking_query(booking)
            if query:
                unlocated.append({"id": str(booking.id), "kind": "booking", "title": booking.location_label or booking.provider, "query": query})
            continue
        points.append(
            {
                "id": str(booking.id),
                "kind": "booking",
                "title": booking.location_label or booking.provider,
                "subtitle": booking.category.value,
                "latitude": booking.latitude,
                "longitude": booking.longitude,
                "status": booking.status.value,
            }
        )
    for place in places:
        if travel_space_id is not None and place.travel_space_id not in (None, travel_space_id):
            continue
        if place.location.latitude is None or place.location.longitude is None:
            query = ", ".join(part for part in (place.location.name, place.location.address) if part)
            unlocated.append({"id": str(place.id), "kind": "place", "title": place.location.name, "query": query})
            continue
        points.append(
            {
                "id": str(place.id),
                "kind": "place",
                "title": place.location.name,
                "subtitle": place.location.category,
                "latitude": place.location.latitude,
                "longitude": place.location.longitude,
                "status": place.status.value,
            }
        )
    for photo in photos:
        if travel_space_id is not None and photo.travel_space_id != travel_space_id:
            continue
        if photo.latitude is None or photo.longitude is None:
            continue
        points.append(
            {
                "id": str(photo.id),
                "kind": "photo",
                "title": photo.place_label or photo.caption or photo.filename,
                "subtitle": photo.taken_on.isoformat() if photo.taken_on else "Photo",
                "latitude": photo.latitude,
                "longitude": photo.longitude,
                "status": "saved",
            }
        )
    return {"points": points, "unlocated": unlocated, "routing_note": ROUTING_NOTE}


def _booking_query(booking: Booking) -> str | None:
    """Text the phone can look up for a booking with no coordinates. Flights are skipped."""
    if booking.category == BookingCategory.flight:
        return None
    details = booking.details or {}
    for key in ("address", "meeting_point", "pickup_location", "venue"):
        value = details.get(key)
        if isinstance(value, str) and len(value.strip()) > 4:
            name = details.get("property_name") or details.get("venue")
            return f"{name}, {value.strip()}" if isinstance(name, str) and name not in value else value.strip()
    name = details.get("property_name") or booking.location_label
    return name.strip() if isinstance(name, str) and name.strip() else None
