"""Add amounts the traveller entered. Currencies are never converted here."""

from datetime import date, timedelta
from decimal import Decimal


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        return start, date(year, 12, 31)
    return start, date(year, month + 1, 1) - timedelta(days=1)


def recurring_is_active(starts_on: date, ends_on: date | None, month_start: date, month_end: date) -> bool:
    if starts_on > month_end:
        return False
    if ends_on is not None and ends_on < month_start:
        return False
    return True


def add_by_currency(rows: list[tuple[str, Decimal]]) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = {}
    for currency, amount in rows:
        totals[currency] = totals.get(currency, Decimal("0.00")) + amount
    return totals


def even_split(total: Decimal, count: int) -> list[Decimal]:
    """Split an amount into cents. The first shares take any leftover cent."""
    if count < 1:
        return []
    cents = int((total.quantize(Decimal("0.01")) * 100).to_integral_value())
    base, extra = divmod(cents, count)
    return [Decimal(base + (1 if index < extra else 0)) / Decimal(100) for index in range(count)]


def money_text(amount: Decimal) -> str:
    return f"{amount.quantize(Decimal('0.01'))}"
