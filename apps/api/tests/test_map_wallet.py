import os
import tempfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/places.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402
from app.services.money import even_split  # noqa: E402


def test_even_split_keeps_every_cent():
    shares = even_split(Decimal("10.00"), 3)
    assert shares == [Decimal("3.34"), Decimal("3.33"), Decimal("3.33")]
    assert sum(shares) == Decimal("10.00")


def test_map_wallet_and_split_use_only_saved_records():
    with TestClient(create_app()) as client:
        token = client.post(
            "/api/v1/auth/dev-login", json={"email": "map@travelos.test", "display_name": "Ada"}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Munich", "start_date": "2026-12-29", "end_date": "2027-01-06"},
            headers=headers,
        ).json()
        client.post(
            "/api/v1/bookings",
            json={
                "travel_space_id": space["id"],
                "category": "accommodation",
                "provider": "Hotel",
                "status": "confirmed",
                "location_label": "Hotel without a pin",
            },
            headers=headers,
        )
        client.post(
            "/api/v1/saved-places",
            json={"name": "Market", "travel_space_id": space["id"], "latitude": 48.13, "longitude": 11.57},
            headers=headers,
        )
        mapped = client.get(f"/api/v1/map/points?travel_space_id={space['id']}", headers=headers).json()
        assert [point["title"] for point in mapped["points"]] == ["Market"]
        assert "not connected" in mapped["routing_note"]
        spent = client.post(
            "/api/v1/living/expenses",
            json={
                "travel_space_id": space["id"],
                "name": "Dinner",
                "category": "groceries",
                "amount": "10.00",
                "currency": "EUR",
                "spent_on": "2026-12-30",
                "split_with": ["Ada", "Sam", "Jo"],
            },
            headers=headers,
        ).json()
        assert [row["amount"] for row in spent["splits"]] == ["3.34", "3.33", "3.33"]
        tomorrow = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()
        document = client.post(
            "/api/v1/wallet/documents",
            json={"kind": "passport", "title": "Passport", "expires_on": tomorrow},
            headers=headers,
        )
        assert document.status_code == 201
        reminders = client.get("/api/v1/reminders", headers=headers).json()
        assert any(note["kind"] == "document_expiry" and "Passport" in note["body"] for note in reminders)
        assert all("must" not in note["body"].lower() for note in reminders)
