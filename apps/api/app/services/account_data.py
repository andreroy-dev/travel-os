"""Account export and deletion (PRD 7.1: account export and deletion; App Store 5.1.1(v))."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Booking,
    Conversation,
    ConversationMessage,
    EmailRecord,
    Integration,
    ItineraryItem,
    Journey,
    Location,
    Notification,
    SavedPlace,
    Stay,
    TravelSpace,
    User,
    UserPreference,
)
from app.services.gmail import revoke_google_access

# Never leave the server, even in the user's own export.
_PRIVATE_COLUMNS = {"token_ciphertext", "supabase_user_id"}


def _plain(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (uuid.UUID, Decimal)):
        return str(value)
    if hasattr(value, "value"):  # enums
        return value.value
    return value


def _row(record) -> dict:
    return {
        column.key: _plain(getattr(record, column.key))
        for column in inspect(record).mapper.column_attrs
        if column.key not in _PRIVATE_COLUMNS
    }


def export_account(session: Session, user: User) -> dict:
    def rows(model) -> list[dict]:
        return [_row(r) for r in session.scalars(select(model).where(model.user_id == user.id)).all()]

    places = session.scalars(select(SavedPlace).where(SavedPlace.user_id == user.id)).all()
    location_ids = [place.location_id for place in places]
    locations = (
        session.scalars(select(Location).where(Location.id.in_(location_ids))).all() if location_ids else []
    )
    conversations = session.scalars(select(Conversation).where(Conversation.user_id == user.id)).all()
    conversation_ids = [c.id for c in conversations]
    messages = (
        session.scalars(
            select(ConversationMessage).where(ConversationMessage.conversation_id.in_(conversation_ids))
        ).all()
        if conversation_ids
        else []
    )
    preference = session.get(UserPreference, user.id)
    return {
        "exported_at": datetime.now().isoformat(),
        "format": "travel-os-export/1",
        "user": _row(user),
        "preferences": _row(preference) if preference else None,
        "travel_spaces": rows(TravelSpace),
        "stays": rows(Stay),
        "journeys": rows(Journey),
        "bookings": rows(Booking),
        "itinerary_items": rows(ItineraryItem),
        "saved_places": [_row(p) for p in places],
        "locations": [_row(location) for location in locations],
        "imported_emails": rows(EmailRecord),
        "integrations": rows(Integration),
        "notifications": rows(Notification),
        "conversations": [_row(c) for c in conversations],
        "conversation_messages": [_row(m) for m in messages],
    }


def delete_account(session: Session, user: User) -> None:
    """Revoke Gmail access, then delete the user; everything they own cascades."""
    for integration in session.scalars(select(Integration).where(Integration.user_id == user.id)).all():
        revoke_google_access(integration.token_ciphertext)
    # Locations the user created for their own saved places are private to them.
    owned_locations = session.scalars(
        select(Location).where(Location.created_by_user_id == user.id)
    ).all()
    session.delete(user)
    session.flush()
    for location in owned_locations:
        session.delete(location)
    session.commit()
