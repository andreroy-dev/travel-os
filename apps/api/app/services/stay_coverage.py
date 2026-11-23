"""Night-by-night accommodation coverage for a Travel Space.

A night is identified by the date it starts on. An accommodation booking from
the 3rd to the 5th covers the nights of the 3rd and the 4th; the traveller
checks out on the 5th, so the 5th itself needs a new place only if the trip
continues. The last day of the space is the day you leave, so it has no night.

An overnight flight, train, bus or cruise covers the night it departs on when
it arrives on a later date. Stays the traveller adds themselves (a friend's
place, their own flat) count the same way as bookings.

Pure date arithmetic, no AI (PRD 4.5 / 6.5).
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.models.entities import Booking, BookingCategory, BookingStatus, Journey, Stay

MAX_NIGHTS = 400

_TRANSIT = {
    BookingCategory.flight,
    BookingCategory.train,
    BookingCategory.bus,
    BookingCategory.cruise,
}

_GETTING_THERE = _TRANSIT | {BookingCategory.transfer, BookingCategory.car_rental}


@dataclass
class Night:
    date: date
    status: str  # booked | own_stay | transit | gap
    title: str | None = None
    booking_id: object | None = None
    stay_id: object | None = None
    night_index: int | None = None
    night_count: int | None = None


@dataclass
class Gap:
    start: date  # first night with nowhere to sleep
    end: date  # the morning after the last such night
    nights: int


@dataclass
class Move:
    """Switching from one place to stay to another on `date`."""

    date: date
    from_title: str
    to_title: str
    has_transport: bool


@dataclass
class Coverage:
    nights: list[Night] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    moves: list[Move] = field(default_factory=list)
    total_nights: int = 0
    covered_nights: int = 0


@dataclass
class _Cover:
    start: date
    end: date
    status: str
    title: str
    booking_id: object | None = None
    stay_id: object | None = None


def _day(value: datetime | date | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _booking_title(booking: Booking) -> str:
    details = booking.details or {}
    for key in ("property_name", "title"):
        value = details.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return booking.location_label or booking.provider


def _covers(bookings: list[Booking], stays: list[Stay]) -> list[_Cover]:
    covers: list[_Cover] = []
    for booking in bookings:
        if booking.status == BookingStatus.cancelled:
            continue
        start, end = _day(booking.starts_at), _day(booking.ends_at)
        if start is None or end is None or end <= start:
            continue
        if booking.category == BookingCategory.accommodation:
            covers.append(_Cover(start, end, "booked", _booking_title(booking), booking_id=booking.id))
        elif booking.category in _TRANSIT:
            covers.append(_Cover(start, end, "transit", _booking_title(booking), booking_id=booking.id))
    for stay in stays:
        if stay.start_date is None or stay.end_date is None or stay.end_date <= stay.start_date:
            continue
        covers.append(_Cover(stay.start_date, stay.end_date, "own_stay", stay.title, stay_id=stay.id))
    return covers


def compute_coverage(
    start: date | None,
    end: date | None,
    bookings: list[Booking],
    stays: list[Stay],
    journeys: list[Journey] | None = None,
) -> Coverage:
    if start is None or end is None or end <= start:
        return Coverage()
    covers = _covers(bookings, stays)
    # A real bed beats a seat on a plane when both overlap the same night.
    rank = {"booked": 0, "own_stay": 1, "transit": 2}
    covers.sort(key=lambda cover: (rank[cover.status], cover.start))

    nights: list[Night] = []
    total = min((end - start).days, MAX_NIGHTS)
    for offset in range(total):
        night = start + timedelta(days=offset)
        match = next((c for c in covers if c.start <= night < c.end), None)
        if match is None:
            nights.append(Night(date=night, status="gap"))
            continue
        nights.append(
            Night(
                date=night,
                status=match.status,
                title=match.title,
                booking_id=match.booking_id,
                stay_id=match.stay_id,
                night_index=(night - match.start).days + 1,
                night_count=(match.end - match.start).days,
            )
        )

    gaps: list[Gap] = []
    for night in nights:
        if night.status != "gap":
            continue
        if gaps and gaps[-1].end == night.date:
            gaps[-1].end = night.date + timedelta(days=1)
            gaps[-1].nights += 1
        else:
            gaps.append(Gap(start=night.date, end=night.date + timedelta(days=1), nights=1))

    travel_days = {
        _day(booking.starts_at)
        for booking in bookings
        if booking.category in _GETTING_THERE and booking.status != BookingStatus.cancelled
    } | {journey.depart_on for journey in journeys or [] if journey.depart_on is not None}

    moves: list[Move] = []
    for previous, current in zip(nights, nights[1:]):
        if previous.status not in ("booked", "own_stay") or current.status not in ("booked", "own_stay"):
            continue
        same = (previous.booking_id, previous.stay_id) == (current.booking_id, current.stay_id)
        if same or previous.title == current.title:
            continue
        moves.append(
            Move(
                date=current.date,
                from_title=previous.title or "",
                to_title=current.title or "",
                has_transport=current.date in travel_days,
            )
        )

    return Coverage(
        nights=nights,
        moves=moves,
        gaps=gaps,
        total_nights=len(nights),
        covered_nights=sum(1 for night in nights if night.status != "gap"),
    )
