from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.models.entities import Booking, TravelSpace
from app.schemas import BookingIn, BookingOut, reject_large_details
from app.services.booking_details import field_catalog
from app.services.itinerary_sync import sync_booking_itinerary
from app.services.validation import ensure_currency, ensure_datetime_order, ensure_timezone

router = APIRouter()


@router.get("/bookings/fields")
def booking_fields() -> list[dict]:
    return field_catalog()


def _apply(booking: Booking, payload: BookingIn) -> None:
    reject_large_details(payload.details)
    ensure_datetime_order(payload.starts_at, payload.ends_at)
    booking.travel_space_id = payload.travel_space_id
    booking.category = payload.category
    booking.provider = payload.provider.strip()
    booking.confirmation_reference = (
        payload.confirmation_reference.strip().upper() if payload.confirmation_reference else None
    )
    booking.status = payload.status
    booking.starts_at = payload.starts_at
    booking.ends_at = payload.ends_at
    booking.timezone = ensure_timezone(payload.timezone)
    booking.location_label = payload.location_label
    booking.latitude = payload.latitude
    booking.longitude = payload.longitude
    booking.price_amount = payload.price_amount
    booking.price_currency = ensure_currency(payload.price_currency)
    booking.cancellation_policy = payload.cancellation_policy
    booking.notes = payload.notes
    booking.details = payload.details


@router.get("/bookings", response_model=list[BookingOut])
def list_bookings(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID | None = None,
) -> list[Booking]:
    statement = select(Booking).where(Booking.user_id == user.id).order_by(Booking.starts_at)
    if travel_space_id is not None:
        owned(session, TravelSpace, travel_space_id, user.id)
        statement = statement.where(Booking.travel_space_id == travel_space_id)
    return list(session.scalars(statement).all())


@router.post("/bookings", response_model=BookingOut, status_code=201)
def create_booking(payload: BookingIn, user: CurrentUser, session: DbSession) -> Booking:
    if payload.travel_space_id is not None:
        owned(session, TravelSpace, payload.travel_space_id, user.id)
    booking = Booking(user_id=user.id, category=payload.category, provider=payload.provider)
    _apply(booking, payload)
    session.add(booking)
    session.flush()
    sync_booking_itinerary(session, booking)
    session.commit()
    session.refresh(booking)
    return booking


@router.get("/bookings/{booking_id}", response_model=BookingOut)
def read_booking(booking_id: UUID, user: CurrentUser, session: DbSession) -> Booking:
    return owned(session, Booking, booking_id, user.id)


@router.patch("/bookings/{booking_id}", response_model=BookingOut)
def update_booking(
    booking_id: UUID, payload: BookingIn, user: CurrentUser, session: DbSession
) -> Booking:
    booking = owned(session, Booking, booking_id, user.id)
    if payload.travel_space_id is not None:
        owned(session, TravelSpace, payload.travel_space_id, user.id)
    _apply(booking, payload)
    sync_booking_itinerary(session, booking)
    session.commit()
    session.refresh(booking)
    return booking


@router.delete("/bookings/{booking_id}", status_code=204)
def delete_booking(booking_id: UUID, user: CurrentUser, session: DbSession) -> None:
    booking = owned(session, Booking, booking_id, user.id)
    session.delete(booking)
    session.commit()
