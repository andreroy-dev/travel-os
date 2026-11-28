import os
import tempfile
import uuid
from datetime import date

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models.entities import Base, Booking, BookingSourceKind, User  # noqa: E402
from app.services.ingest import InboundMessage, compute_dedup_key, ingest_message  # noqa: E402


def _session() -> tuple[Session, uuid.UUID]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    user = User(email="t@example.com", display_name="T")
    session.add(user)
    session.commit()
    return session, user.id


BODY = """Booking confirmed. Agoda.
Confirmation number: ABC12345
Check-in: 12 March 2027
Check-out: 15 March 2027
See https://www.agoda.com/reservation/ABC12345 for details."""


def _msg(external_id: str, source: BookingSourceKind, domain: str | None = None) -> InboundMessage:
    return InboundMessage(
        external_id, "Your Agoda booking confirmation", BODY, source, sender_domain=domain
    )


def test_dedup_key_is_stable_and_case_insensitive():
    d = date(2027, 3, 12)
    a = compute_dedup_key("Marriott", "abc123", "Roy", d)
    assert a == compute_dedup_key(" marriott ", "ABC123", "roy", d)
    assert a != compute_dedup_key("Marriott", "ABC123", "Roy", date(2027, 3, 13))
    assert a != compute_dedup_key("Marriott", "ABC124", "Roy", d)
    assert len(a) == 64 and "ABC123" not in a


def test_no_confirmation_means_no_key():
    assert compute_dedup_key("Marriott", None, "Roy", date(2027, 3, 12)) is None


def test_same_confirmation_from_two_channels_is_one_booking():
    session, uid = _session()
    ingest_message(session, uid, _msg("g-1", BookingSourceKind.gmail, "Agoda.com"))
    ingest_message(session, uid, _msg("f-1", BookingSourceKind.forward, "gmail.com"))
    session.commit()
    bookings = list(session.scalars(select(Booking)))
    assert len(bookings) == 1
    b = bookings[0]
    assert b.source_channel == "gmail"
    assert b.sender_domain == "agoda.com"
    assert b.booking_url == "https://www.agoda.com/reservation/ABC12345"
    assert b.dedup_key


def test_near_match_is_flagged_not_merged():
    session, uid = _session()
    ingest_message(session, uid, _msg("g-1", BookingSourceKind.gmail))
    other = BODY.replace("ABC12345", "ZZZ99999")
    ingest_message(
        session, uid, InboundMessage("g-2", "Agoda confirmation", other, BookingSourceKind.gmail)
    )
    session.commit()
    bookings = list(session.scalars(select(Booking).order_by(Booking.created_at)))
    assert len(bookings) == 2
    flagged = [b for b in bookings if (b.details or {}).get("possible_duplicate_of")]
    assert len(flagged) == 1
    assert flagged[0].details["possible_duplicate_of"] in {str(b.id) for b in bookings}
