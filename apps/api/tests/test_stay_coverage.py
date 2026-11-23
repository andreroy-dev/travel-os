import uuid
from datetime import UTC, date, datetime

from app.models.entities import Booking, BookingCategory, BookingStatus, Stay, TravelSpaceStatus
from app.services.space_status import status_from_dates
from app.services.stay_coverage import compute_coverage


def _at(day: str, hour: int) -> datetime:
    y, m, d = (int(part) for part in day.split("-"))
    return datetime(y, m, d, hour, tzinfo=UTC)


def _hotel(start: str, end: str, status=BookingStatus.confirmed) -> Booking:
    return Booking(
        id=uuid.uuid4(),
        category=BookingCategory.accommodation,
        provider="Booking.com",
        status=status,
        starts_at=_at(start, 15),
        ends_at=_at(end, 11),
        details={"property_name": f"Hotel {start}"},
    )


def test_multi_night_booking_covers_every_night_until_checkout():
    # Booked 3rd to 5th: the 4th must not be flagged; the trip ends on the 5th.
    cov = compute_coverage(date(2027, 1, 3), date(2027, 1, 5), [_hotel("2027-01-03", "2027-01-05")], [])
    assert [n.status for n in cov.nights] == ["booked", "booked"]
    assert [n.night_index for n in cov.nights] == [1, 2]
    assert cov.gaps == []


def test_gap_after_checkout_is_grouped_by_nights():
    # Checked out on the 5th, next booking starts on the 7th: nights of 5th and 6th are open.
    bookings = [_hotel("2027-01-03", "2027-01-05"), _hotel("2027-01-07", "2027-01-09")]
    cov = compute_coverage(date(2027, 1, 3), date(2027, 1, 9), bookings, [])
    assert len(cov.gaps) == 1
    assert cov.gaps[0].start == date(2027, 1, 5)
    assert cov.gaps[0].end == date(2027, 1, 7)
    assert cov.gaps[0].nights == 2


def test_back_to_back_bookings_leave_no_gap():
    bookings = [_hotel("2027-01-03", "2027-01-05"), _hotel("2027-01-05", "2027-01-06")]
    cov = compute_coverage(date(2027, 1, 3), date(2027, 1, 6), bookings, [])
    assert cov.gaps == []


def test_friends_place_fills_a_gap():
    stay = Stay(id=uuid.uuid4(), title="With Anna", start_date=date(2027, 1, 5), end_date=date(2027, 1, 7))
    bookings = [_hotel("2027-01-03", "2027-01-05"), _hotel("2027-01-07", "2027-01-09")]
    cov = compute_coverage(date(2027, 1, 3), date(2027, 1, 9), bookings, [stay])
    assert cov.gaps == []
    assert cov.nights[2].status == "own_stay"


def test_overnight_flight_covers_its_night_and_cancelled_hotels_do_not():
    flight = Booking(
        id=uuid.uuid4(),
        category=BookingCategory.flight,
        provider="Cleartrip",
        status=BookingStatus.confirmed,
        starts_at=_at("2026-12-29", 19),
        ends_at=_at("2026-12-30", 6),
    )
    cancelled = _hotel("2026-12-30", "2026-12-31", status=BookingStatus.cancelled)
    cov = compute_coverage(date(2026, 12, 29), date(2026, 12, 31), [flight, cancelled], [])
    assert [n.status for n in cov.nights] == ["transit", "gap"]


def test_restore_status_follows_dates():
    today = date(2026, 11, 17)
    assert status_from_dates(date(2026, 12, 29), date(2027, 1, 31), today) == TravelSpaceStatus.upcoming
    assert status_from_dates(date(2026, 11, 1), date(2026, 11, 30), today) == TravelSpaceStatus.active
    assert status_from_dates(date(2026, 10, 1), date(2026, 10, 5), today) == TravelSpaceStatus.completed
    assert status_from_dates(None, None, today) == TravelSpaceStatus.planning


def test_switching_hotels_asks_how_you_get_there_unless_travel_is_booked():
    from app.models.entities import Journey

    a = _hotel("2027-01-03", "2027-01-05")
    b = _hotel("2027-01-05", "2027-01-07")
    cov = compute_coverage(date(2027, 1, 3), date(2027, 1, 7), [a, b], [])
    assert len(cov.moves) == 1
    assert cov.moves[0].date == date(2027, 1, 5)
    assert cov.moves[0].has_transport is False

    train = Journey(origin_label="Vienna", destination_label="Salzburg", mode="train", depart_on=date(2027, 1, 5))
    cov = compute_coverage(date(2027, 1, 3), date(2027, 1, 7), [a, b], [], [train])
    assert cov.moves[0].has_transport is True
