from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.models.entities import Booking, EmailRecord, TravelSpace
from app.schemas import (
    BookingDetailOut,
    BookingIn,
    BookingOut,
    BookingPatch,
    BookingSourceOut,
    reject_large_details,
)
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


def _source_url(external_id: str) -> str | None:
    # Gmail message ids are stored as "gmail:<id>"; this opens the original message.
    if external_id.startswith("gmail:"):
        return f"https://mail.google.com/mail/u/0/#all/{external_id.removeprefix('gmail:')}"
    return None


@router.get("/bookings/{booking_id}", response_model=BookingDetailOut)
def read_booking(booking_id: UUID, user: CurrentUser, session: DbSession) -> BookingDetailOut:
    booking = owned(session, Booking, booking_id, user.id)
    emails = session.scalars(
        select(EmailRecord)
        .where(EmailRecord.user_id == user.id, EmailRecord.booking_id == booking.id)
        .order_by(EmailRecord.received_at)
    ).all()
    out = BookingDetailOut.model_validate(booking, from_attributes=True)
    out.sources = [
        BookingSourceOut(
            kind=email.external_id.split(":", 1)[0] if ":" in email.external_id else "email",
            subject=email.subject,
            received_at=email.received_at,
            url=_source_url(email.external_id),
        )
        for email in emails
    ]
    return out


@router.patch("/bookings/{booking_id}", response_model=BookingOut)
def update_booking(
    booking_id: UUID, payload: BookingPatch, user: CurrentUser, session: DbSession
) -> Booking:
    booking = owned(session, Booking, booking_id, user.id)
    sent = payload.model_fields_set
    if "travel_space_id" in sent and payload.travel_space_id is not None:
        owned(session, TravelSpace, payload.travel_space_id, user.id)
    for required in ("category", "provider", "status"):
        if required in sent and getattr(payload, required) is None:
            raise AppError(422, f"{required.replace('_', ' ').capitalize()} cannot be empty.")
    if "details" in sent:
        reject_large_details(payload.details)
    for name in sent:
        value = getattr(payload, name)
        if name == "provider":
            value = value.strip()
        elif name == "confirmation_reference":
            value = value.strip().upper() if value else None
        elif name == "timezone":
            value = ensure_timezone(value)
        elif name == "price_currency":
            value = ensure_currency(value)
        setattr(booking, name, value)
    ensure_datetime_order(booking.starts_at, booking.ends_at)
    sync_booking_itinerary(session, booking)
    session.commit()
    session.refresh(booking)
    return booking


@router.delete("/bookings/{booking_id}", status_code=204)
def delete_booking(booking_id: UUID, user: CurrentUser, session: DbSession) -> None:
    booking = owned(session, Booking, booking_id, user.id)
    session.delete(booking)
    session.commit()
