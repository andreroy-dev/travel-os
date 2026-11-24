import os
import tempfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/living.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402
from app.services.money import add_by_currency, month_bounds, recurring_is_active  # noqa: E402
from app.services.visa_days import count_stay  # noqa: E402


def _client() -> TestClient:
    return TestClient(create_app())


def _auth(client: TestClient) -> dict[str, str]:
    token = client.post("/api/v1/auth/dev-login", json={"email": "living@travelos.test", "display_name": "Ada"}).json()[
        "access_token"
    ]
    return {"Authorization": f"Bearer {token}"}


def test_money_keeps_currencies_separate_and_a_month_is_full_when_active():
    start, end = month_bounds(2027, 2)
    assert (end - start).days == 27
    assert recurring_is_active(date(2027, 1, 1), None, start, end)
    assert not recurring_is_active(date(2027, 3, 1), None, start, end)
    totals = add_by_currency([("EUR", Decimal("10.00")), ("USD", Decimal("3.00")), ("EUR", Decimal("2.50"))])
    assert totals["EUR"] == Decimal("12.50")
    assert totals["USD"] == Decimal("3.00")


def test_schengen_and_countdown_count_logged_days_only():
    on = date(2026, 1, 10)
    schengen = count_stay("schengen_90_180", [(date(2026, 1, 1), date(2026, 1, 10))], on, None)
    assert schengen["used_days"] == 10
    assert schengen["remaining_days"] == 80
    assert "not an entry decision" in schengen["disclaimer"]
    countdown = count_stay("countdown", [(date(2026, 1, 1), None)], on, 30)
    assert countdown["used_days"] == 10
    assert countdown["remaining_days"] == 20
    overlap = count_stay(
        "countdown",
        [(date(2026, 1, 1), date(2026, 1, 5)), (date(2026, 1, 5), date(2026, 1, 6))],
        date(2026, 1, 6),
        30,
    )
    assert overlap["used_days"] == 6


def test_living_records_sum_what_was_entered_and_do_not_invent_a_booking():
    with _client() as client:
        headers = _auth(client)
        today = datetime.now(UTC).date()
        month_start = today.replace(day=1)
        space = client.post(
            "/api/v1/travel-spaces",
            json={
                "title": "Berlin",
                "kind": "long_stay",
                "start_date": month_start.isoformat(),
                "end_date": (today + timedelta(days=200)).isoformat(),
            },
            headers=headers,
        ).json()
        space_id = space["id"]
        assert (
            client.post(
                "/api/v1/living/expenses",
                json={
                    "travel_space_id": space_id,
                    "name": "Groceries",
                    "category": "groceries",
                    "amount": "40.00",
                    "currency": "eur",
                    "spent_on": today.isoformat(),
                },
                headers=headers,
            ).status_code
            == 201
        )
        client.post(
            "/api/v1/living/expenses",
            json={
                "travel_space_id": space_id,
                "name": "Metro",
                "category": "transport",
                "amount": "10.00",
                "currency": "USD",
                "spent_on": today.isoformat(),
            },
            headers=headers,
        )
        client.post(
            "/api/v1/living/recurring",
            json={
                "travel_space_id": space_id,
                "name": "Rent",
                "category": "rent",
                "amount": "100.00",
                "currency": "EUR",
                "starts_on": month_start.isoformat(),
            },
            headers=headers,
        )
        client.put(
            "/api/v1/living/budget",
            json={
                "travel_space_id": space_id,
                "year": today.year,
                "month": today.month,
                "amount": "200.00",
                "currency": "EUR",
            },
            headers=headers,
        )
        summary = client.get(
            f"/api/v1/living/summary?travel_space_id={space_id}&year={today.year}&month={today.month}",
            headers=headers,
        ).json()
        by_currency = {row["currency"]: row for row in summary["currencies"]}
        assert by_currency["EUR"]["combined"] == "140.00"
        assert by_currency["EUR"]["remaining"] == "60.00"
        assert by_currency["USD"]["combined"] == "10.00"
        assert by_currency["USD"]["remaining"] is None
        assert "converted" in summary["note"]
        refused = client.post(
            "/api/v1/living/neighbourhoods",
            json={"travel_space_id": space_id, "name": "Neukölln", "safety_note": "Feels fine"},
            headers=headers,
        )
        assert refused.status_code == 422
        noted = client.post(
            "/api/v1/living/neighbourhoods",
            json={
                "travel_space_id": space_id,
                "name": "Neukölln",
                "transport_note": "U8 to the apartment",
                "safety_note": "City report",
                "safety_source": "Berlin police 2025 report",
            },
            headers=headers,
        )
        assert noted.status_code == 201
        client.post(
            "/api/v1/living/services",
            json={"travel_space_id": space_id, "name": "The gym on the corner", "category": "gym"},
            headers=headers,
        )
        assert client.get("/api/v1/bookings", headers=headers).json() == []
        reply = client.post(
            "/api/v1/ai/chat",
            json={"message": "How much have I spent?", "travel_space_id": space_id},
            headers=headers,
        ).json()["reply"]
        assert "EUR 140.00" in reply
        assert "USD 10.00" in reply
        gym = client.post(
            "/api/v1/ai/chat",
            json={"message": "Find a gym near my apartment", "travel_space_id": space_id},
            headers=headers,
        ).json()["reply"]
        assert "The gym on the corner" in gym
        today = datetime.now(UTC).date()
        entered = (today - timedelta(days=9)).isoformat()
        log = client.post(
            "/api/v1/living/visa-logs",
            json={"label": "Schengen log", "rule": "schengen_90_180", "country_code": "de"},
            headers=headers,
        ).json()
        counted = client.post(
            f"/api/v1/living/visa-logs/{log['id']}/spans",
            json={"entered_on": entered, "exited_on": today.isoformat()},
            headers=headers,
        ).json()["count"]
        assert counted["used_days"] == 10
        assert counted["remaining_days"] == 80
        assert "not an entry decision" in counted["disclaimer"]
