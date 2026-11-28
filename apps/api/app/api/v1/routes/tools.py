"""Packing, trip budgets, currency conversion, and settlement."""

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.models.entities import TravelSpace, UserPreference
from app.models.living import Expense, ExpenseSplit
from app.models.tools import PackingItem, TripBudget
from app.services.fx import convert, latest_rates
from app.services.settlement import settle

router = APIRouter()


class PackingIn(BaseModel):
    travel_space_id: UUID
    label: str = Field(min_length=1, max_length=200)
    kind: str = "packing"


class PackingPatch(BaseModel):
    packed: bool


class PackingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    travel_space_id: UUID
    kind: str
    label: str
    packed: bool


class BudgetIn(BaseModel):
    travel_space_id: UUID
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)


def _space(session, space_id: UUID, user_id: UUID) -> TravelSpace:
    return owned(session, TravelSpace, space_id, user_id)


@router.get("/packing", response_model=list[PackingOut])
def list_packing(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> list[PackingItem]:
    _space(session, travel_space_id, user.id)
    return list(
        session.scalars(
            select(PackingItem).where(
                PackingItem.travel_space_id == travel_space_id
            )
        ).all()
    )


@router.post("/packing", response_model=PackingOut, status_code=201)
def create_packing(payload: PackingIn, user: CurrentUser, session: DbSession) -> PackingItem:
    _space(session, payload.travel_space_id, user.id)
    if payload.kind not in {"packing", "document"}:
        raise AppError(422, "Choose packing or a document checklist.")
    row = PackingItem(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        kind=payload.kind,
        label=payload.label.strip(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.patch("/packing/{item_id}", response_model=PackingOut)
def update_packing(item_id: UUID, payload: PackingPatch, user: CurrentUser, session: DbSession) -> PackingItem:
    row = owned(session, PackingItem, item_id, user.id)
    row.packed = payload.packed
    session.commit()
    session.refresh(row)
    return row


@router.delete("/packing/{item_id}", status_code=204)
def delete_packing(item_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, PackingItem, item_id, user.id))
    session.commit()


@router.get("/trip-budgets")
def get_budget(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> dict:
    _space(session, travel_space_id, user.id)
    row = session.scalar(
        select(TripBudget).where(TripBudget.travel_space_id == travel_space_id)
    )
    if row is None:
        return {"amount": None, "currency": None}
    return {"amount": f"{row.amount}", "currency": row.currency}


@router.put("/trip-budgets")
def put_budget(payload: BudgetIn, user: CurrentUser, session: DbSession) -> dict:
    _space(session, payload.travel_space_id, user.id)
    row = session.scalar(
        select(TripBudget).where(
            TripBudget.user_id == user.id, TripBudget.travel_space_id == payload.travel_space_id
        )
    )
    if row is None:
        row = TripBudget(user_id=user.id, travel_space_id=payload.travel_space_id, amount=payload.amount, currency=payload.currency.upper())
        session.add(row)
    else:
        row.amount = payload.amount
        row.currency = payload.currency.upper()
    session.commit()
    session.refresh(row)
    return {"amount": f"{row.amount}", "currency": row.currency}


@router.get("/fx/convert")
def convert_amount(
    user: CurrentUser,
    session: DbSession,
    amount: Decimal,
    from_currency: str,
    to_currency: str,
) -> dict:
    del user
    if amount <= 0:
        raise AppError(422, "Enter an amount greater than zero.")
    quote = convert(
        {from_currency.upper(): amount},
        to_currency.upper(),
        latest_rates(session),
    )
    return quote


@router.get("/settlement")
def settlement(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> dict:
    _space(session, travel_space_id, user.id)
    expenses = list(
        session.scalars(
            select(Expense).where(Expense.travel_space_id == travel_space_id)
        ).all()
    )
    splits = list(session.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id.in_([e.id for e in expenses]))).all())
    grouped: dict = {}
    for split in splits:
        grouped.setdefault(split.expense_id, []).append((split.name, Decimal(split.amount)))
    payload = settle(user.display_name, [(expense.currency, grouped.get(expense.id, [])) for expense in expenses])
    preference = session.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    payload["home_currency"] = preference.home_currency if preference else "USD"
    return payload
