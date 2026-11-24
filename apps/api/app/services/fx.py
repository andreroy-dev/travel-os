"""Convert saved amounts with a published rate. Nothing is guessed if a currency is missing."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.fx import FxSnapshot

SOURCE = "https://api.frankfurter.app/latest?from=EUR"
TTL = timedelta(hours=1)
NOTE = "Rates are the European Central Bank figures published by Frankfurter. They refresh when the saved table is older than an hour."


def _table(payload: dict) -> dict[str, Decimal]:
    rates = {"EUR": Decimal("1")}
    for code, value in payload.get("rates", {}).items():
        rates[str(code).upper()] = Decimal(str(value))
    return rates


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def latest_rates(session: Session) -> dict | None:
    row = session.scalar(select(FxSnapshot).where(FxSnapshot.id == 1))
    fresh = row is not None and _aware(row.fetched_at) >= datetime.now(UTC) - TTL
    if fresh and row is not None:
        payload = json.loads(row.rates_json)
        payload["stale"] = False
        payload["fetched_at"] = row.fetched_at.isoformat()
        return payload
    try:
        response = httpx.get(SOURCE, timeout=10)
        response.raise_for_status()
        payload = response.json()
        if "rates" not in payload:
            raise ValueError("Rate table has no rates.")
    except (httpx.HTTPError, ValueError):
        if row is None:
            return None
        payload = json.loads(row.rates_json)
        payload["stale"] = True
        payload["fetched_at"] = row.fetched_at.isoformat()
        return payload
    now = datetime.now(UTC)
    stored = row or FxSnapshot(id=1, base="EUR", rate_date="", rates_json="{}", fetched_at=now)
    stored.base = "EUR"
    stored.rate_date = str(payload.get("date", ""))
    stored.rates_json = json.dumps({"date": stored.rate_date, "rates": payload["rates"]})
    stored.fetched_at = now
    session.add(stored)
    session.commit()
    saved = json.loads(stored.rates_json)
    saved["stale"] = False
    saved["fetched_at"] = now.isoformat()
    return saved


def convert(amounts: dict[str, Decimal], home: str, payload: dict | None) -> dict:
    home = home.upper()
    if payload is None:
        return {
            "home_currency": home,
            "total": None,
            "lines": [
                {"currency": code, "amount": f"{amount.quantize(Decimal('0.01'))}", "converted": None, "rate": None}
                for code, amount in sorted(amounts.items())
            ],
            "missing": sorted(amounts),
            "rate_date": None,
            "fetched_at": None,
            "stale": False,
            "note": "No exchange rate could be loaded, so the total in your currency is not shown.",
        }
    table = _table(payload)
    lines = []
    missing = []
    total = Decimal("0.00")
    home_per_eur = table.get(home)
    for code, amount in sorted(amounts.items()):
        amount = amount.quantize(Decimal("0.01"))
        per_eur = table.get(code)
        if home_per_eur is None or per_eur is None or per_eur == 0:
            missing.append(code)
            lines.append({"currency": code, "amount": f"{amount}", "converted": None, "rate": None})
            continue
        rate = (home_per_eur / per_eur).quantize(Decimal("0.0001"))
        converted = (amount * rate).quantize(Decimal("0.01"))
        total += converted
        lines.append({"currency": code, "amount": f"{amount}", "converted": f"{converted}", "rate": f"{rate}"})
    complete = not missing and home_per_eur is not None
    return {
        "home_currency": home,
        "total": f"{total.quantize(Decimal('0.01'))}" if complete else None,
        "lines": lines,
        "missing": missing,
        "rate_date": payload.get("date"),
        "fetched_at": payload.get("fetched_at"),
        "stale": bool(payload.get("stale")),
        "note": NOTE if complete else "A currency in this trip is not in the rate table, so no combined total is shown.",
    }
