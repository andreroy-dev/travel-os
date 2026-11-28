from datetime import UTC, datetime
from decimal import Decimal
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.living_schemas import BudgetIn, EventIn, MoneyIn, NeighbourhoodIn, RecordOut, ServiceIn, VisaLogIn, VisaSpanIn
from app.models.entities import TravelSpace, UserPreference
from app.models.living import (
    Expense,
    ExpenseSplit,
    LocalEvent,
    LocalService,
    MonthlyBudget,
    NeighbourhoodNote,
    RecurringCost,
    VisaLog,
    VisaRule,
    VisaSpan,
)
from app.services.dashboard_situation import booked_costs
from app.services.fx import convert, latest_rates
from app.services.living_summary import month_totals
from app.services.money import add_by_currency, even_split, month_bounds
from app.services.visa_days import count_stay

router = APIRouter()

MONEY_NOTE = "Totals add the amounts you entered. Nothing is converted or estimated."


def _space(session, space_id: UUID, user_id: UUID) -> TravelSpace:
    return owned(session, TravelSpace, space_id, user_id)


def _currency(value: str) -> str:
    return value.strip().upper()


def _url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AppError(422, "A source link must be an http or https address.")
    return value.strip()


@router.get("/living/summary")
def living_summary(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID,
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
) -> dict:
    _space(session, travel_space_id, user.id)
    return {
        "year": year,
        "month": month,
        "currencies": month_totals(session, user.id, travel_space_id, year, month),
        "note": MONEY_NOTE,
    }


@router.get("/living/expenses", response_model=list[RecordOut])
def list_expenses(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> list[dict]:
    _space(session, travel_space_id, user.id)
    rows = list(
        session.scalars(
            select(Expense)
            .where(Expense.travel_space_id == travel_space_id)
            .order_by(Expense.spent_on.desc())
        ).all()
    )
    splits = list(
        session.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id.in_([r.id for r in rows]))).all()
    )
    grouped: dict = {}
    for split in splits:
        grouped.setdefault(split.expense_id, []).append({"name": split.name, "amount": split.amount})
    result = []
    for row in rows:
        data = RecordOut.model_validate(row, from_attributes=True).model_dump()
        data["splits"] = grouped.get(row.id, [])
        result.append(data)
    return result


@router.post("/living/expenses", response_model=RecordOut, status_code=201)
def create_expense(payload: MoneyIn, user: CurrentUser, session: DbSession) -> dict:
    _space(session, payload.travel_space_id, user.id)
    if payload.spent_on is None:
        raise AppError(422, "An expense needs the date you paid it.")
    names = [name.strip() for name in payload.split_with if name.strip()]
    if len(names) > 12:
        raise AppError(422, "Split a cost between 12 people at most.")
    row = Expense(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        name=payload.name.strip(),
        category=payload.category,
        amount=payload.amount,
        currency=_currency(payload.currency),
        spent_on=payload.spent_on,
    )
    session.add(row)
    session.flush()
    shares = even_split(payload.amount, len(names))
    for name, share in zip(names, shares, strict=True):
        session.add(ExpenseSplit(user_id=user.id, expense_id=row.id, name=name, amount=share))
    session.commit()
    session.refresh(row)
    data = RecordOut.model_validate(row, from_attributes=True).model_dump()
    data["splits"] = [{"name": name, "amount": share} for name, share in zip(names, shares, strict=True)]
    return data


@router.get("/living/exchange")
def exchange_totals(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID,
    scope: str = Query(default="trip", pattern="^(trip|month)$"),
    include_bookings: bool = True,
) -> dict:
    _space(session, travel_space_id, user.id)
    preference = session.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    home = preference.home_currency if preference else "USD"
    expenses = list(
        session.scalars(
            select(Expense).where(Expense.travel_space_id == travel_space_id)
        ).all()
    )
    if scope == "month":
        start, end = month_bounds(datetime.now(UTC).year, datetime.now(UTC).month)
        expenses = [row for row in expenses if start <= row.spent_on <= end]
    rows = [(row.currency, Decimal(row.amount)) for row in expenses]
    if scope == "trip" and include_bookings:
        # Prepaid bookings count toward what the trip costs; cancelled ones are excluded.
        rows += [(row["currency"], Decimal(row["amount"])) for row in booked_costs(session, user.id, travel_space_id)]
    amounts = add_by_currency(rows)
    return convert(amounts, home, latest_rates(session))


@router.delete("/living/expenses/{record_id}", status_code=204)
def delete_expense(record_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, Expense, record_id, user.id))
    session.commit()


@router.get("/living/recurring", response_model=list[RecordOut])
def list_recurring(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> list[RecurringCost]:
    _space(session, travel_space_id, user.id)
    return list(
        session.scalars(
            select(RecurringCost).where(
                RecurringCost.travel_space_id == travel_space_id
            )
        ).all()
    )


@router.post("/living/recurring", response_model=RecordOut, status_code=201)
def create_recurring(payload: MoneyIn, user: CurrentUser, session: DbSession) -> RecurringCost:
    _space(session, payload.travel_space_id, user.id)
    if payload.starts_on is None:
        raise AppError(422, "A monthly cost needs the date it starts.")
    row = RecurringCost(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        name=payload.name.strip(),
        category=payload.category,
        amount=payload.amount,
        currency=_currency(payload.currency),
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/living/recurring/{record_id}", status_code=204)
def delete_recurring(record_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, RecurringCost, record_id, user.id))
    session.commit()


@router.put("/living/budget", response_model=RecordOut)
def set_budget(payload: BudgetIn, user: CurrentUser, session: DbSession) -> MonthlyBudget:
    _space(session, payload.travel_space_id, user.id)
    row = session.scalar(
        select(MonthlyBudget).where(
            MonthlyBudget.user_id == user.id,
            MonthlyBudget.travel_space_id == payload.travel_space_id,
            MonthlyBudget.year == payload.year,
            MonthlyBudget.month == payload.month,
        )
    )
    if row is None:
        row = MonthlyBudget(
            user_id=user.id,
            travel_space_id=payload.travel_space_id,
            year=payload.year,
            month=payload.month,
            amount=payload.amount,
            currency=_currency(payload.currency),
        )
        session.add(row)
    else:
        row.amount = payload.amount
        row.currency = _currency(payload.currency)
    session.commit()
    session.refresh(row)
    return row


@router.get("/living/services", response_model=list[RecordOut])
def list_services(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> list[LocalService]:
    _space(session, travel_space_id, user.id)
    return list(
        session.scalars(
            select(LocalService).where(
                LocalService.travel_space_id == travel_space_id
            )
        ).all()
    )


@router.post("/living/services", response_model=RecordOut, status_code=201)
def create_service(payload: ServiceIn, user: CurrentUser, session: DbSession) -> LocalService:
    _space(session, payload.travel_space_id, user.id)
    row = LocalService(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        name=payload.name.strip(),
        category=payload.category,
        address=payload.address,
        notes=payload.notes,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/living/services/{record_id}", status_code=204)
def delete_service(record_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, LocalService, record_id, user.id))
    session.commit()


@router.get("/living/neighbourhoods", response_model=list[RecordOut])
def list_neighbourhoods(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> list[NeighbourhoodNote]:
    _space(session, travel_space_id, user.id)
    return list(
        session.scalars(
            select(NeighbourhoodNote).where(
                NeighbourhoodNote.travel_space_id == travel_space_id
            )
        ).all()
    )


@router.post("/living/neighbourhoods", response_model=RecordOut, status_code=201)
def create_neighbourhood(payload: NeighbourhoodIn, user: CurrentUser, session: DbSession) -> NeighbourhoodNote:
    _space(session, payload.travel_space_id, user.id)
    if payload.safety_note and not (payload.safety_source and payload.safety_source.strip()):
        raise AppError(422, "A safety note needs the source it came from.")
    row = NeighbourhoodNote(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        name=payload.name.strip(),
        accommodation_note=payload.accommodation_note,
        transport_note=payload.transport_note,
        distance_note=payload.distance_note,
        amenities_note=payload.amenities_note,
        safety_note=payload.safety_note,
        safety_source=payload.safety_source.strip() if payload.safety_source else None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/living/neighbourhoods/{record_id}", status_code=204)
def delete_neighbourhood(record_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, NeighbourhoodNote, record_id, user.id))
    session.commit()


@router.get("/living/events", response_model=list[RecordOut])
def list_events(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> list[LocalEvent]:
    _space(session, travel_space_id, user.id)
    return list(
        session.scalars(
            select(LocalEvent)
            .where(LocalEvent.travel_space_id == travel_space_id)
            .order_by(LocalEvent.starts_on)
        ).all()
    )


@router.post("/living/events", response_model=RecordOut, status_code=201)
def create_event(payload: EventIn, user: CurrentUser, session: DbSession) -> LocalEvent:
    _space(session, payload.travel_space_id, user.id)
    row = LocalEvent(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        title=payload.title.strip(),
        starts_on=payload.starts_on,
        place_label=payload.place_label,
        source_url=_url(payload.source_url),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/living/events/{record_id}", status_code=204)
def delete_event(record_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, LocalEvent, record_id, user.id))
    session.commit()


def _visa_out(log: VisaLog, spans: list[VisaSpan]) -> dict:
    count = count_stay(
        log.rule.value,
        [(span.entered_on, span.exited_on) for span in spans],
        datetime.now(UTC).date(),
        log.allowed_days,
    )
    return {
        "id": log.id,
        "label": log.label,
        "country_code": log.country_code,
        "rule": log.rule.value,
        "allowed_days": log.allowed_days,
        "spans": [
            {"id": span.id, "entered_on": span.entered_on, "exited_on": span.exited_on} for span in spans
        ],
        "count": count,
    }


@router.get("/living/visa-logs")
def list_visa_logs(user: CurrentUser, session: DbSession) -> list[dict]:
    logs = list(session.scalars(select(VisaLog).where(VisaLog.user_id == user.id)).all())
    spans = list(session.scalars(select(VisaSpan).where(VisaSpan.user_id == user.id)).all())
    grouped: dict = {}
    for span in spans:
        grouped.setdefault(span.visa_log_id, []).append(span)
    return [_visa_out(log, grouped.get(log.id, [])) for log in logs]


@router.post("/living/visa-logs", status_code=201)
def create_visa_log(payload: VisaLogIn, user: CurrentUser, session: DbSession) -> dict:
    if payload.rule == VisaRule.countdown and payload.allowed_days is None:
        raise AppError(422, "A countdown needs the number of days you are allowed.")
    log = VisaLog(
        user_id=user.id,
        label=payload.label.strip(),
        country_code=payload.country_code.upper() if payload.country_code else None,
        rule=payload.rule,
        allowed_days=None if payload.rule == VisaRule.schengen_90_180 else payload.allowed_days,
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return _visa_out(log, [])


@router.post("/living/visa-logs/{log_id}/spans", status_code=201)
def create_visa_span(log_id: UUID, payload: VisaSpanIn, user: CurrentUser, session: DbSession) -> dict:
    log = owned(session, VisaLog, log_id, user.id)
    if payload.exited_on is not None and payload.exited_on < payload.entered_on:
        raise AppError(422, "The exit date is before the entry date.")
    span = VisaSpan(
        user_id=user.id,
        visa_log_id=log.id,
        entered_on=payload.entered_on,
        exited_on=payload.exited_on,
    )
    session.add(span)
    session.commit()
    spans = list(session.scalars(select(VisaSpan).where(VisaSpan.visa_log_id == log.id)).all())
    return _visa_out(log, spans)


@router.delete("/living/visa-logs/{log_id}", status_code=204)
def delete_visa_log(log_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, VisaLog, log_id, user.id))
    session.commit()
