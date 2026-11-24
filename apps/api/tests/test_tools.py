from decimal import Decimal

from app.services.settlement import settle


def test_settlement_counts_only_splits_that_include_the_payer():
    result = settle(
        "Ada",
        [
            ("EUR", [("Ada", Decimal("5.00")), ("Sam", Decimal("5.00"))]),
            ("INR", [("Sam", Decimal("10.00")), ("Jo", Decimal("10.00"))]),
        ],
    )
    assert result["balances"] == [{"name": "Sam", "currency": "EUR", "amount": "5.00"}]
    assert result["skipped"] == 1


def test_packing_and_trip_budget_are_saved_records(monkeypatch):
    import os
    import tempfile

    os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/tools.db"
    import app.core.config as config
    import app.core.database as database

    config.get_settings.cache_clear()
    database._engine = None
    database._session_factory = None
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setattr(
        "app.services.fx.httpx.get",
        lambda url, timeout, **_kw: type(
            "R",
            (),
            {"raise_for_status": lambda self: None, "json": lambda self: {"date": "2026-11-23", "rates": {"INR": "100"}}},
        )(),
    )
    with TestClient(create_app()) as client:
        token = client.post("/api/v1/auth/dev-login", json={"email": "tools@travelos.test", "display_name": "Ada"}).json()[
            "access_token"
        ]
        headers = {"Authorization": f"Bearer {token}"}
        client.put("/api/v1/preferences", json={"home_currency": "INR", "timezone": "Asia/Kolkata"}, headers=headers)
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Berlin", "start_date": "2026-12-01", "end_date": "2026-12-10"},
            headers=headers,
        ).json()
        item = client.post(
            "/api/v1/packing",
            json={"travel_space_id": space["id"], "label": "Passport", "kind": "document"},
            headers=headers,
        )
        assert item.status_code == 201
        packed = client.patch(f"/api/v1/packing/{item.json()['id']}", json={"packed": True}, headers=headers)
        assert packed.json()["packed"] is True
        budget = client.put(
            "/api/v1/trip-budgets",
            json={"travel_space_id": space["id"], "amount": "1000.00", "currency": "INR"},
            headers=headers,
        )
        assert budget.json()["amount"] == "1000.00"
        quote = client.get("/api/v1/fx/convert", params={"amount": "10", "from_currency": "EUR", "to_currency": "INR"}, headers=headers)
        assert quote.status_code == 200
        assert quote.json()["total"] == "1000.00"
        client.post(
            "/api/v1/living/expenses",
            json={
                "travel_space_id": space["id"],
                "name": "Dinner",
                "amount": "10.00",
                "currency": "EUR",
                "spent_on": "2026-12-02",
                "split_with": ["Ada", "Sam"],
            },
            headers=headers,
        )
        balances = client.get("/api/v1/settlement", params={"travel_space_id": space["id"]}, headers=headers).json()
        assert balances["balances"] == [{"name": "Sam", "currency": "EUR", "amount": "5.00"}]
