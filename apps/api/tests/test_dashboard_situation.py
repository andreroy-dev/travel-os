import os
import tempfile
from datetime import UTC, datetime, timedelta

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


def _auth(client, email):
    token = client.post("/api/v1/auth/dev-login", json={"email": email, "display_name": "D"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_home_reports_long_stay_facts_from_saved_records():
    today = datetime.now(UTC).date()
    with TestClient(create_app()) as client:
        h = _auth(client, "home@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={
                "title": "Berlin",
                "kind": "long_stay",
                "status": "active",
                "start_date": (today - timedelta(days=10)).isoformat(),
                "end_date": (today + timedelta(days=80)).isoformat(),
            },
            headers=h,
        ).json()
        client.post(
            "/api/v1/bookings",
            json={
                "travel_space_id": space["id"],
                "category": "accommodation",
                "provider": "Flat",
                "starts_at": f"{(today - timedelta(days=10)).isoformat()}T15:00:00",
                "ends_at": f"{(today + timedelta(days=20)).isoformat()}T11:00:00",
                "details": {"property_name": "Kreuzberg flat"},
            },
            headers=h,
        )
        client.post("/api/v1/packing", json={"travel_space_id": space["id"], "label": "Adapter"}, headers=h)

        home = client.get("/api/v1/dashboard", headers=h).json()
        assert home["mode"] == "long_stay"
        s = home["situation"]
        assert s["day_number"] == 11 and s["total_days"] == 91
        assert s["tonight"]["title"] == "Kreuzberg flat" and s["tonight"]["night_index"] == 11
        assert s["nights"]["total"] == 90 and s["nights"]["covered"] == 30
        assert s["nights"]["gaps"][0]["nights"] == 60
        assert s["packing"] == {"total": 1, "packed": 0}
        assert s["bookings"]["confirmed"] == 1


def test_home_at_home_lists_upcoming_trips():
    today = datetime.now(UTC).date()
    with TestClient(create_app()) as client:
        h = _auth(client, "athome@travelos.test")
        client.post(
            "/api/v1/travel-spaces",
            json={
                "title": "Lisbon",
                "status": "upcoming",
                "start_date": (today + timedelta(days=40)).isoformat(),
                "end_date": (today + timedelta(days=45)).isoformat(),
            },
            headers=h,
        )
        home = client.get("/api/v1/dashboard", headers=h).json()
        assert home["situation"]["upcoming"][0]["title"] == "Lisbon"
        assert home["situation"]["upcoming"][0]["days_until"] == 40


def test_gap_search_links_open_providers_with_the_dates():
    with TestClient(create_app()) as client:
        h = _auth(client, "links@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Austria", "destination_name": "Vienna", "start_date": "2027-03-01", "end_date": "2027-03-09"},
            headers=h,
        ).json()
        body = client.get(
            f"/api/v1/travel-spaces/{space['id']}/stay-search?start=2027-03-05&end=2027-03-07", headers=h
        ).json()
        assert body["city"] == "Vienna"
        booking = next(link for link in body["links"] if link["provider"] == "Booking.com")["url"]
        assert "ss=Vienna" in booking and "checkin=2027-03-05" in booking and "checkout=2027-03-07" in booking
        other = client.get(
            f"/api/v1/travel-spaces/{space['id']}/stay-search?start=2027-03-05&end=2027-03-07&city=Linz", headers=h
        ).json()
        assert other["city"] == "Linz"
        bad = client.get(f"/api/v1/travel-spaces/{space['id']}/stay-search?start=2027-03-07&end=2027-03-05", headers=h)
        assert bad.status_code == 422


def test_trip_summary_counts_booking_prices_and_drops_cancelled_ones():
    with TestClient(create_app()) as client:
        h = _auth(client, "costs@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces", json={"title": "Costs", "start_date": "2027-05-01", "end_date": "2027-05-05"}, headers=h
        ).json()

        def book(price, currency):
            return client.post(
                "/api/v1/bookings",
                json={
                    "travel_space_id": space["id"], "category": "accommodation", "provider": "H",
                    "starts_at": "2027-05-01T15:00:00", "ends_at": "2027-05-03T11:00:00",
                    "price_amount": price, "price_currency": currency,
                },
                headers=h,
            ).json()

        book("200.00", "EUR")
        b = book("50.50", "EUR")
        book("10000", "INR")
        summary = client.get(f"/api/v1/travel-spaces/{space['id']}/summary", headers=h).json()
        assert summary["booked_costs"] == [
            {"currency": "EUR", "amount": "250.50", "count": 2},
            {"currency": "INR", "amount": "10000.00", "count": 1},
        ]
        client.patch(f"/api/v1/bookings/{b['id']}", json={"status": "cancelled"}, headers=h)
        summary = client.get(f"/api/v1/travel-spaces/{space['id']}/summary", headers=h).json()
        assert summary["booked_costs"][0] == {"currency": "EUR", "amount": "200.00", "count": 1}
        assert summary["nights"]["covered"] == 2
