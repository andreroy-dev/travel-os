"""Compose long-stay records into totals. No estimates and no currency conversion."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.living import Expense, LocalService, MonthlyBudget, RecurringCost
from app.services.money import add_by_currency, money_text, month_bounds, recurring_is_active


def month_totals(session: Session, user_id, space_id, year: int, month: int) -> list[dict]:
    start, end = month_bounds(year, month)
    expenses = list(
        session.scalars(
            select(Expense).where(Expense.user_id == user_id, Expense.travel_space_id == space_id)
        ).all()
    )
    recurring = list(
        session.scalars(
            select(RecurringCost).where(
                RecurringCost.user_id == user_id, RecurringCost.travel_space_id == space_id
            )
        ).all()
    )
    spent = add_by_currency(
        [(row.currency, row.amount) for row in expenses if start <= row.spent_on <= end]
    )
    monthly = add_by_currency(
        [
            (row.currency, row.amount)
            for row in recurring
            if recurring_is_active(row.starts_on, row.ends_on, start, end)
        ]
    )
    budget = session.scalar(
        select(MonthlyBudget).where(
            MonthlyBudget.user_id == user_id,
            MonthlyBudget.travel_space_id == space_id,
            MonthlyBudget.year == year,
            MonthlyBudget.month == month,
        )
    )
    currencies = set(spent) | set(monthly)
    if budget is not None:
        currencies.add(budget.currency)
    rows = []
    for currency in sorted(currencies):
        expense_total = spent.get(currency, Decimal("0.00"))
        recurring_total = monthly.get(currency, Decimal("0.00"))
        combined = expense_total + recurring_total
        row = {
            "currency": currency,
            "expenses": money_text(expense_total),
            "recurring": money_text(recurring_total),
            "combined": money_text(combined),
            "budget": None,
            "remaining": None,
        }
        if budget is not None and budget.currency == currency:
            row["budget"] = money_text(budget.amount)
            row["remaining"] = money_text(budget.amount - combined)
        rows.append(row)
    return rows


def assistant_context(session: Session, user_id, space_id, today: date) -> dict:
    if space_id is None:
        return {"money": [], "local_services": []}
    totals = month_totals(session, user_id, space_id, today.year, today.month)
    services = session.scalars(
        select(LocalService).where(LocalService.user_id == user_id, LocalService.travel_space_id == space_id)
    ).all()
    return {
        "money": [
            {"month": f"{today.year}-{today.month:02d}", "currency": row["currency"], "combined": row["combined"]}
            for row in totals
            if Decimal(row["combined"]) != 0
        ],
        "local_services": [{"name": service.name, "category": service.category.value} for service in services],
    }
