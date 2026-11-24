"""Reminders computed from saved bookings and stay gaps. Nothing is invented."""

from datetime import date, timedelta

from app.models.entities import Booking, BookingCategory, BookingStatus


def upcoming_reminders(bookings: list[Booking], gaps: list, today: date) -> list[dict]:
    soon = today + timedelta(days=1)
    week = today + timedelta(days=7)
    notes: list[dict] = []
    for booking in bookings:
        if booking.status == BookingStatus.cancelled or booking.starts_at is None:
            continue
        start = booking.starts_at.date()
        if start != soon:
            continue
        if booking.category == BookingCategory.flight:
            notes.append(
                {
                    "kind": "flight_tomorrow",
                    "title": "Flight tomorrow",
                    "body": booking.location_label or booking.provider or "Saved flight",
                    "when": start,
                }
            )
        elif booking.category == BookingCategory.accommodation:
            notes.append(
                {
                    "kind": "check_in_tomorrow",
                    "title": "Check-in tomorrow",
                    "body": booking.location_label or booking.provider or "Saved stay",
                    "when": start,
                }
            )
    for gap in gaps:
        if today <= gap.start <= week:
            notes.append(
                {
                    "kind": "open_gap",
                    "title": "Nights still open",
                    "body": f"{gap.nights} night{'s' if gap.nights != 1 else ''} from {gap.start.isoformat()} have no stay.",
                    "when": gap.start,
                }
            )
    return notes
