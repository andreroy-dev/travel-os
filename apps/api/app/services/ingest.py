import hashlib
import re
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Booking,
    BookingSourceKind,
    BookingStatus,
    EmailClassification,
    EmailRecord,
    Notification,
    TravelSpace,
    TravelSpaceStatus,
)
from app.services.association import match_travel_space
from app.services.extraction import ExtractedBooking, classify_email, extract_booking, is_promotion
from app.services.itinerary_sync import sync_booking_itinerary


_URL_RE = re.compile(r"https://[^\s<>\"')]+")


def _first_url(body: str) -> str | None:
    match = _URL_RE.search(body or "")
    return match.group(0).rstrip(".,;")[:500] if match else None


def compute_dedup_key(
    provider: str | None,
    confirmation_reference: str | None,
    surname: str | None,
    start: date | None,
) -> str | None:
    """Stable hash of provider + confirmation + surname + start date.

    Needs a confirmation number; without one there is nothing reliable to match on.
    """
    if not confirmation_reference:
        return None
    parts = [
        (provider or "").strip().lower(),
        confirmation_reference.strip().upper(),
        (surname or "").strip().lower(),
        start.isoformat() if start else "",
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


class InboundMessage:
    def __init__(
        self,
        external_id: str,
        subject: str,
        body: str,
        source: BookingSourceKind,
        received_at: datetime | None = None,
        integration_id: uuid.UUID | None = None,
        travel_space_id: uuid.UUID | None = None,
        date_window: tuple[date, date] | None = None,
        sender_domain: str | None = None,
        booking_url: str | None = None,
    ) -> None:
        self.external_id = external_id
        self.subject = subject[:500]
        self.body = body
        self.source = source
        self.received_at = received_at
        self.integration_id = integration_id
        self.travel_space_id = travel_space_id
        self.date_window = date_window
        self.sender_domain = sender_domain.lower()[:255] if sender_domain else None
        self.booking_url = booking_url or _first_url(body)


class IngestResult:
    def __init__(
        self,
        status: str,
        classification: EmailClassification,
        booking_id: uuid.UUID | None = None,
        detail: str = "",
    ) -> None:
        self.status = status
        self.classification = classification
        self.booking_id = booking_id
        self.detail = detail


def record_for_review(session: Session, user_id: uuid.UUID, message: InboundMessage, detail: str) -> IngestResult:
    """Store a source reference when the file cannot be read, without keeping the bytes."""
    existing = session.scalar(
        select(EmailRecord).where(
            EmailRecord.user_id == user_id,
            EmailRecord.external_id == message.external_id,
        )
    )
    if existing is not None:
        return IngestResult(
            status="duplicate",
            classification=existing.classification,
            booking_id=existing.booking_id,
            detail="This file was already imported.",
        )
    _record(session, user_id, message, EmailClassification.needs_review, None)
    _notify(session, user_id, "import_needs_review", "A file needs a look", detail)
    return IngestResult(status="needs_review", classification=EmailClassification.needs_review, detail=detail)


def ingest_message(session: Session, user_id: uuid.UUID, message: InboundMessage) -> IngestResult:
    existing = session.scalar(
        select(EmailRecord).where(
            EmailRecord.user_id == user_id,
            EmailRecord.external_id == message.external_id,
        )
    )
    if existing is not None:
        if message.date_window is not None and existing.booking_id is None:
            session.delete(existing)
            session.flush()
        elif message.date_window is not None:
            return _refresh_seen(session, user_id, message, existing)
        else:
            return _already_seen(session, message, existing)

    classification = classify_email(message.subject, message.body)
    if classification == EmailClassification.ignored:
        _record(session, user_id, message, classification, None)
        return IngestResult(status="ignored", classification=classification, detail="Not a booking.")

    extracted = extract_booking(message.subject, message.body, classification)
    if message.date_window is not None and (
        is_promotion(message.subject, message.body) or not extracted.confirmation_reference
    ):
        _record(session, user_id, message, EmailClassification.ignored, None)
        return IngestResult(
            status="skipped",
            classification=EmailClassification.ignored,
            detail="This email is not a booking confirmation.",
        )
    if message.date_window is not None:
        if not _focus_on_window(extracted, message.date_window):
            return IngestResult(
                status="outside_dates" if extracted.mentioned_dates or extracted.starts_at else "skipped",
                classification=classification,
                detail="The booking dates are outside this Travel Space."
                if extracted.mentioned_dates or extracted.starts_at
                else "This email has no travel dates, so it was not filed.",
            )
    if not extracted.is_actionable:
        record_classification = EmailClassification.needs_review
        _record(session, user_id, message, record_classification, None)
        if message.date_window is None:
            _notify(
                session,
                user_id,
                "import_needs_review",
                "A message needs a look",
                "A possible booking email did not include a confirmation number or date.",
            )
        return IngestResult(
            status="needs_review",
            classification=record_classification,
            detail="Missing confirmation number and dates.",
        )

    booking = _apply_extracted(session, user_id, message, extracted, classification)
    _record(session, user_id, message, classification, booking.id if booking else None)
    if booking is None:
        return IngestResult(
            status="unmatched",
            classification=classification,
            detail="No saved booking matched this update.",
        )
    verb = {
        EmailClassification.confirmation: "Imported a booking",
        EmailClassification.modification: "Updated a booking",
        EmailClassification.cancellation: "Marked a booking cancelled",
    }[classification]
    if message.date_window is None:
        _notify(session, user_id, "booking_import", verb, f"{booking.provider}: {booking.confirmation_reference or booking.category.value}")
    return IngestResult(
        status="imported",
        classification=classification,
        booking_id=booking.id,
        detail=verb,
    )


def _refresh_seen(
    session: Session, user_id: uuid.UUID, message: InboundMessage, existing: EmailRecord
) -> IngestResult:
    """Read a confirmation again so a better extraction can fill the booking."""
    classification = classify_email(message.subject, message.body)
    extracted = extract_booking(message.subject, message.body, classification)
    window = message.date_window
    if (
        window is None
        or is_promotion(message.subject, message.body)
        or not extracted.confirmation_reference
    ):
        return IngestResult(
            status="duplicate",
            classification=existing.classification,
            booking_id=existing.booking_id,
            detail="This message was already imported.",
        )
    if not _focus_on_window(extracted, window):
        return IngestResult(
            status="outside_dates",
            classification=classification,
            detail="The booking dates are outside this Travel Space.",
        )
    booking = _apply_extracted(session, user_id, message, extracted, classification)
    if booking is None:
        return IngestResult(
            status="duplicate",
            classification=existing.classification,
            booking_id=existing.booking_id,
            detail="This message was already imported.",
        )
    existing.classification = classification
    existing.booking_id = booking.id
    existing.subject = message.subject
    return IngestResult(
        status="imported",
        classification=classification,
        booking_id=booking.id,
        detail="Updated the booking from this email.",
    )


def _already_seen(session: Session, message: InboundMessage, existing: EmailRecord) -> IngestResult:
    if message.date_window is None or existing.booking_id is None:
        return IngestResult(
            status="duplicate",
            classification=existing.classification,
            booking_id=existing.booking_id,
            detail="This message was already imported.",
        )
    booking = session.get(Booking, existing.booking_id)
    if booking is None or not _in_window(booking.starts_at, booking.ends_at, message.date_window):
        return IngestResult(
            status="outside_dates",
            classification=existing.classification,
            detail="The booking dates are outside this Travel Space.",
        )
    if message.travel_space_id is not None and booking.travel_space_id is None:
        booking.travel_space_id = message.travel_space_id
        sync_booking_itinerary(session, booking)
    if booking.travel_space_id == message.travel_space_id:
        return IngestResult(
            status="imported",
            classification=existing.classification,
            booking_id=booking.id,
            detail="Filed this booking into the Travel Space.",
        )
    return IngestResult(
        status="skipped",
        classification=existing.classification,
        booking_id=booking.id,
        detail="This booking already belongs to another Travel Space.",
    )


def _focus_on_window(extracted: ExtractedBooking, window: tuple[date, date]) -> bool:
    """Keep a booking when any of its dates fall inside the Travel Space."""
    start, end = window
    if start > end:
        start, end = end, start
    seen: set[date] = set()
    inside: list[datetime] = []
    candidates = list(extracted.mentioned_dates)
    if extracted.starts_at:
        candidates.append(extracted.starts_at)
    if extracted.ends_at:
        candidates.append(extracted.ends_at)
    for item in candidates:
        day = item.date()
        if day in seen or day < start or day > end:
            continue
        seen.add(day)
        inside.append(item)
    if not inside:
        return _in_window(extracted.starts_at, extracted.ends_at, window)
    labeled_start = extracted.starts_at if extracted.starts_at and extracted.starts_at.date() in seen else None
    labeled_end = extracted.ends_at if extracted.ends_at and extracted.ends_at.date() in seen else None
    extracted.starts_at = labeled_start or min(inside)
    extracted.ends_at = labeled_end or max(inside)
    if extracted.ends_at < extracted.starts_at:
        extracted.ends_at = max(inside)
    return True


def _in_window(starts_at: datetime | None, ends_at: datetime | None, window: tuple[date, date]) -> bool:
    start, end = window
    if start > end:
        start, end = end, start
    booking_start = starts_at.date() if starts_at else None
    booking_end = ends_at.date() if ends_at else None
    if booking_start is None and booking_end is None:
        return False
    booking_start = booking_start or booking_end
    booking_end = booking_end or booking_start
    return booking_start <= end and booking_end >= start


def _apply_extracted(
    session: Session,
    user_id: uuid.UUID,
    message: InboundMessage,
    extracted: ExtractedBooking,
    classification: EmailClassification,
) -> Booking | None:
    start_day = extracted.starts_at.date() if extracted.starts_at else None
    key = compute_dedup_key(
        extracted.provider,
        extracted.confirmation_reference,
        (extracted.details or {}).get("surname"),
        start_day,
    )
    existing = _find_existing(session, user_id, extracted, key)
    if classification == EmailClassification.cancellation:
        if existing is None:
            return None
        existing.status = BookingStatus.cancelled
        sync_booking_itinerary(session, existing)
        return existing

    if existing is None and classification == EmailClassification.modification:
        return None

    spaces = list(
        session.scalars(
            select(TravelSpace).where(
                TravelSpace.user_id == user_id,
                TravelSpace.status != TravelSpaceStatus.archived,
            )
        )
    )
    start = extracted.starts_at.date() if extracted.starts_at else None
    end = extracted.ends_at.date() if extracted.ends_at else start
    space_id = match_travel_space(spaces, start, end)

    if existing is None:
        existing = Booking(
            user_id=user_id,
            category=extracted.category,
            provider=extracted.provider or "Unknown provider",
            confirmation_reference=extracted.confirmation_reference,
            status=extracted.status,
            source=message.source,
            source_channel=message.source.value,
            sender_domain=message.sender_domain,
            booking_url=message.booking_url,
        )
        session.add(existing)
        session.flush()
        near = _near_match(session, user_id, existing, start_day)
        if near is not None:
            existing.details = {**(existing.details or {}), "possible_duplicate_of": str(near.id)}

    existing.dedup_key = key or existing.dedup_key
    existing.booking_url = existing.booking_url or message.booking_url
    existing.sender_domain = existing.sender_domain or message.sender_domain
    existing.category = extracted.category
    existing.provider = extracted.provider or existing.provider
    if extracted.confirmation_reference:
        existing.confirmation_reference = extracted.confirmation_reference
    if classification == EmailClassification.confirmation:
        existing.status = BookingStatus.confirmed
    elif classification == EmailClassification.modification:
        existing.status = BookingStatus.modified
    if extracted.starts_at:
        existing.starts_at = extracted.starts_at
    if extracted.ends_at:
        existing.ends_at = extracted.ends_at
    if extracted.location_label:
        existing.location_label = extracted.location_label
    if message.source == BookingSourceKind.gmail:
        existing.notes = None
    elif not existing.notes and message.subject:
        existing.notes = message.subject[:500]
    if extracted.details:
        existing.details = {
            **extracted.details,
            **({"possible_duplicate_of": existing.details["possible_duplicate_of"]}
               if existing.details and "possible_duplicate_of" in existing.details else {}),
        }
    if extracted.price_amount is not None:
        existing.price_amount = extracted.price_amount
        existing.price_currency = extracted.price_currency
    if extracted.cancellation_policy:
        existing.cancellation_policy = extracted.cancellation_policy
    chosen_space = message.travel_space_id or space_id
    if chosen_space is not None and (
        message.travel_space_id is not None or existing.travel_space_id is None
    ):
        existing.travel_space_id = chosen_space
    sync_booking_itinerary(session, existing)
    return existing


def _find_existing(
    session: Session, user_id: uuid.UUID, extracted: ExtractedBooking, key: str | None = None
) -> Booking | None:
    if key:
        found = session.scalar(select(Booking).where(Booking.user_id == user_id, Booking.dedup_key == key))
        if found is not None:
            return found
    if not extracted.confirmation_reference:
        return None
    return session.scalar(
        select(Booking).where(
            Booking.user_id == user_id,
            Booking.confirmation_reference == extracted.confirmation_reference,
        )
    )


def _near_match(
    session: Session, user_id: uuid.UUID, booking: Booking, start_day: date | None
) -> Booking | None:
    """Same provider and start day under a different confirmation: flag, never merge."""
    if start_day is None or not booking.provider or booking.provider == "Unknown provider":
        return None
    for other in session.scalars(
        select(Booking).where(
            Booking.user_id == user_id,
            Booking.id != booking.id,
            Booking.provider == booking.provider,
        )
    ):
        if other.starts_at and other.starts_at.date() == start_day:
            return other
    return None


def _record(
    session: Session,
    user_id: uuid.UUID,
    message: InboundMessage,
    classification: EmailClassification,
    booking_id: uuid.UUID | None,
) -> None:
    session.add(
        EmailRecord(
            user_id=user_id,
            integration_id=message.integration_id,
            external_id=message.external_id,
            subject=message.subject,
            classification=classification,
            booking_id=booking_id,
            received_at=message.received_at,
            processed_at=datetime.now(UTC),
        )
    )


def _notify(session: Session, user_id: uuid.UUID, kind: str, title: str, body: str) -> None:
    session.add(Notification(user_id=user_id, kind=kind, title=title, body=body))
