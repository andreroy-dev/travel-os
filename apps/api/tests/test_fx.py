import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.services.fx import convert, latest_rates


class Response:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def test_exchange_converts_every_currency_into_the_home_currency(monkeypatch):
    calls = {"count": 0}

    def fake_get(url, timeout):
        calls["count"] += 1
        assert "from=EUR" in url
        return Response({"date": "2026-11-21", "rates": {"INR": "100", "USD": "1.1"}})

    monkeypatch.setattr("app.services.fx.httpx.get", fake_get)
    quote = convert(
        {"EUR": Decimal("23.00"), "INR": Decimal("2000.00")},
        "INR",
        {"date": "2026-11-21", "rates": {"INR": "100", "USD": "1.1"}, "stale": False, "fetched_at": "2026-11-23T12:00:00+00:00"},
    )
    assert quote["total"] == "4300.00"
    assert quote["lines"][0] == {"currency": "EUR", "amount": "23.00", "converted": "2300.00", "rate": "100.0000"}
    assert quote["lines"][1]["converted"] == "2000.00"
    assert quote["missing"] == []


def test_missing_currency_does_not_invent_a_total():
    quote = convert({"EUR": Decimal("10"), "XYZ": Decimal("5")}, "INR", {"date": "2026-11-21", "rates": {"INR": "90"}})
    assert quote["total"] is None
    assert quote["missing"] == ["XYZ"]


def test_rates_refresh_after_an_hour(monkeypatch):
    from app.models.fx import FxSnapshot

    class Session:
        def __init__(self):
            self.row = FxSnapshot(
                id=1,
                base="EUR",
                rate_date="2026-11-01",
                rates_json=json.dumps({"date": "2026-11-01", "rates": {"INR": "90"}}),
                fetched_at=datetime.now(UTC) - timedelta(hours=2),
            )

        def scalar(self, _query):
            return self.row

        def add(self, row):
            self.row = row

        def commit(self):
            return None

    def fake_get(url, timeout):
        return Response({"date": "2026-11-23", "rates": {"INR": "100"}})

    monkeypatch.setattr("app.services.fx.httpx.get", fake_get)
    payload = latest_rates(Session())
    assert payload["date"] == "2026-11-23"
    assert payload["stale"] is False


def test_fresh_rates_are_not_fetched_again(monkeypatch):
    from app.models.fx import FxSnapshot

    class Session:
        def scalar(self, _query):
            return FxSnapshot(
                id=1,
                base="EUR",
                rate_date="2026-11-23",
                rates_json=json.dumps({"date": "2026-11-23", "rates": {"INR": "100"}}),
                fetched_at=datetime.now(UTC),
            )

    def fail_get(url, timeout):
        raise AssertionError("A fresh table should not be fetched again.")

    monkeypatch.setattr("app.services.fx.httpx.get", fail_get)
    payload = latest_rates(Session())
    assert payload["rates"]["INR"] == "100"
    assert payload["stale"] is False
