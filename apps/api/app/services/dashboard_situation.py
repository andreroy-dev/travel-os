"""Facts for the adaptive home dashboard (PRD 3.4).

Every number is counted from records the traveller saved; nothing is estimated.
The app decides which of these to show from the dashboard mode.
"""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Booking,
    BookingStatus,
    Journey,
    SavedPlace,
    SavedPlaceStatus,
    Stay,
    TravelSpace,
    TravelSpaceStatus,
)
from app.models.living import VisaLog, VisaSpan
from app.models.memories import MemoryPhoto
from app.models.tools import PackingItem
from app.services.living_summary import month_totals
from app.services.stay_coverage import compute_coverage
from app.services.visa_days import count_stay


def _upcoming(spaces: list[TravelSpace], today: date) -> list[dict]:
    rows = [
        space
        for space in spaces
        if space.status in (TravelSpaceStatus.planning, TravelSpaceStatus.upcoming)
        and (space.end_date is None or space.end_date >= today)
    ]
    rows.sort(key=lambda space: space.start_date or date.max)
    return [
        {
            "id": str(space.id),
            "title": space.title,
            "status": space.status.value,
            "start_date": space.start_date.isoformat() if space.start_date else None,
            "end_date": space.end_date.isoformat() if space.end_date else None,
            "days_until": (space.start_date - today).days if space.start_date and space.start_date >= today else None,
        }
        for space in rows[:5]
    ]


def build_situation(session: Session, user_id, space: TravelSpace | None, spaces: list[TravelSpace], today: date) -> dict:
    visible = [s for s in spaces if s.status != TravelSpaceStatus.archived]
    out: dict = {
        "upcoming": _upcoming(visible, today),
        "trips_completed": sum(1 for s in visible if s.status == TravelSpaceStatus.completed),
        "visa": _visa(session, user_id, today),
    }
    if space is None:
        return out

    start, end = space.start_date, space.end_date
    out["days_until"] = (start - today).days if start and start > today else None
    out["day_number"] = (today - start).days + 1 if start and start <= today else None
    out["total_days"] = (end - start).days + 1 if start and end else None

    bookings = list(
        session.scalars(select(Booking).where(Booking.travel_space_id == space.id)).all()
    )
    live = [b for b in bookings if b.status != BookingStatus.cancelled]
    out["bookings"] = {
        "confirmed": sum(1 for b in live if b.status in (BookingStatus.confirmed, BookingStatus.modified)),
        "planned": sum(1 for b in live if b.status == BookingStatus.planned),
    }

    if start and end:
        stays = list(session.scalars(select(Stay).where(Stay.travel_space_id == space.id)).all())
        journeys = list(
            session.scalars(select(Journey).where(Journey.travel_space_id == space.id)).all()
        )
        coverage = compute_coverage(start, end, bookings, stays, journeys)
        tonight = next((n for n in coverage.nights if n.date == today), None)
        out["nights"] = {
            "covered": coverage.covered_nights,
            "total": coverage.total_nights,
            "gaps": [{"start": g.start.isoformat(), "end": g.end.isoformat(), "nights": g.nights} for g in coverage.gaps],
        }
        if tonight is not None:
            out["tonight"] = {
                "status": tonight.status,
                "title": tonight.title,
                "night_index": tonight.night_index,
                "night_count": tonight.night_count,
                "booking_id": str(tonight.booking_id) if tonight.booking_id else None,
            }

    items = session.scalars(
        select(PackingItem.packed).where(PackingItem.user_id == user_id, PackingItem.travel_space_id == space.id)
    ).all()
    out["packing"] = {"total": len(items), "packed": sum(1 for packed in items if packed)}
    out["money"] = month_totals(session, user_id, space.id, today.year, today.month)
    out["photos"] = session.scalar(
        select(func.count()).select_from(MemoryPhoto).where(
            MemoryPhoto.user_id == user_id, MemoryPhoto.travel_space_id == space.id
        )
    ) or 0
    out["places"] = {
        status.value: session.scalar(
            select(func.count()).select_from(SavedPlace).where(
                SavedPlace.user_id == user_id,
                SavedPlace.travel_space_id == space.id,
                SavedPlace.status == status,
            )
        )
        or 0
        for status in SavedPlaceStatus
    }
    return out


def _visa(session: Session, user_id, today: date) -> list[dict]:
    logs = list(session.scalars(select(VisaLog).where(VisaLog.user_id == user_id)).all())
    if not logs:
        return []
    spans = list(session.scalars(select(VisaSpan).where(VisaSpan.user_id == user_id)).all())
    rows = []
    for log in logs:
        count = count_stay(
            log.rule.value,
            [(s.entered_on, s.exited_on) for s in spans if s.visa_log_id == log.id],
            today,
            log.allowed_days,
        )
        rows.append({"label": log.label, "remaining_days": count["remaining_days"], "limit_days": count["limit_days"]})
    return rows


def booked_costs(session: Session, user_id, space_id) -> list[dict]:
    """What the trip's bookings cost, by currency, from the prices on the confirmations.

    Cancelled bookings drop out automatically, so the trip total follows the bookings.
    """
    rows: dict[str, dict] = {}
    for booking in session.scalars(
        select(Booking).where(
            Booking.user_id == user_id,
            Booking.travel_space_id == space_id,
            Booking.status != BookingStatus.cancelled,
            Booking.price_amount.is_not(None),
        )
    ).all():
        currency = (booking.price_currency or "").upper()
        if not currency:
            continue
        row = rows.setdefault(currency, {"currency": currency, "amount": 0, "count": 0})
        row["amount"] += booking.price_amount
        row["count"] += 1
    return [
        {"currency": row["currency"], "amount": f"{row['amount']:.2f}", "count": row["count"]}
        for row in sorted(rows.values(), key=lambda r: r["currency"])
    ]
