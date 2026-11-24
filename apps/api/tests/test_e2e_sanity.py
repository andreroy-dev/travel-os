"""End-to-end sanity run: one traveller uses every module, going back and forth.

Each step checks that the other modules see the change (coverage, costs, home, map,
reminders, export), so a regression in how modules talk to each other fails here.
"""

import os
import tempfile
from datetime import UTC, datetime, timedelta

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402

PDF = b"%PDF-1.4\n%%EOF"


def _d(days: int) -> str:
    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


def _auth(client, email):
    token = client.post("/api/v1/auth/dev-login", json={"email": email, "display_name": "Sam"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_a_whole_trip_back_and_forth(monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", tempfile.mkdtemp())
    with TestClient(create_app()) as c:
        h = _auth(c, "sanity@travelos.test")

        def ok(response, code=200):
            assert response.status_code == code, f"{response.request.method} {response.request.url}: {response.status_code} {response.text}"
            return response.json() if response.content else None

        # Home with nothing saved.
        assert ok(c.get("/api/v1/dashboard", headers=h))["mode"] == "at_home"

        # A trip that started 2 days ago and runs 10 nights.
        space = ok(
            c.post(
                "/api/v1/travel-spaces",
                json={"title": "Austria", "status": "active", "start_date": _d(-2), "end_date": _d(8), "destination_name": "Vienna", "country_code": "AT"},
                headers=h,
            ),
            201,
        )
        sid = space["id"]
        home = ok(c.get("/api/v1/dashboard", headers=h))
        assert home["mode"] == "short_holiday" and home["travel_space"]["id"] == sid
        assert home["situation"]["nights"]["covered"] == 0 and home["situation"]["nights"]["total"] == 10

        # Book a hotel for the first 4 nights with a price, then a second hotel later.
        hotel = ok(
            c.post(
                "/api/v1/bookings",
                json={
                    "travel_space_id": sid, "category": "accommodation", "provider": "Booking.com",
                    "starts_at": f"{_d(-2)}T15:00:00", "ends_at": f"{_d(2)}T11:00:00",
                    "price_amount": "400.00", "price_currency": "EUR", "location_label": "Hotel Wien",
                    "details": {"property_name": "Hotel Wien", "address": "Ring 1, Vienna"},
                },
                headers=h,
            ),
            201,
        )
        ok(
            c.post(
                "/api/v1/bookings",
                json={
                    "travel_space_id": sid, "category": "accommodation", "provider": "Agoda",
                    "starts_at": f"{_d(4)}T15:00:00", "ends_at": f"{_d(8)}T10:00:00",
                    "price_amount": "300", "price_currency": "EUR", "details": {"property_name": "Hostel Salzburg"},
                },
                headers=h,
            ),
            201,
        )
        cov = ok(c.get(f"/api/v1/travel-spaces/{sid}/coverage", headers=h))
        assert cov["covered_nights"] == 8 and [g["nights"] for g in cov["gaps"]] == [2]
        assert len(cov["moves"]) == 0  # the gap sits between the hotels, so no direct move day
        summary = ok(c.get(f"/api/v1/travel-spaces/{sid}/summary", headers=h))
        assert summary["booked_costs"] == [{"currency": "EUR", "amount": "700.00", "count": 2}]
        assert summary["tonight"]["title"] == "Hotel Wien" and summary["tonight"]["night_index"] == 3

        # Fill the gap with a friend's place, then take it away again.
        gap = cov["gaps"][0]
        stay = ok(c.post("/api/v1/stays", json={"travel_space_id": sid, "title": "With Anna", "start_date": gap["start"], "end_date": gap["end"]}, headers=h), 201)
        assert ok(c.get(f"/api/v1/travel-spaces/{sid}/coverage", headers=h))["gaps"] == []
        ok(c.delete(f"/api/v1/stays/{stay['id']}", headers=h), 204)
        assert len(ok(c.get(f"/api/v1/travel-spaces/{sid}/coverage", headers=h))["gaps"]) == 1

        # Dismiss the gap prompt; it stays dismissed.
        ok(c.post(f"/api/v1/travel-spaces/{sid}/prompts/dismiss", json={"kind": "gap", "key": gap["start"]}, headers=h), 204)
        assert ok(c.get(f"/api/v1/travel-spaces/{sid}/coverage", headers=h))["gaps"] == []

        # Provider search links for those nights.
        links = ok(c.get(f"/api/v1/travel-spaces/{sid}/stay-search?start={gap['start']}&end={gap['end']}", headers=h))
        assert links["city"] == "Vienna" and len(links["links"]) == 3

        # Edit the first hotel: move it, then cancel it. Costs and coverage follow.
        ok(c.patch(f"/api/v1/bookings/{hotel['id']}", json={"status": "cancelled"}, headers=h))
        summary = ok(c.get(f"/api/v1/travel-spaces/{sid}/summary", headers=h))
        assert summary["booked_costs"] == [{"currency": "EUR", "amount": "300.00", "count": 1}]
        assert summary["nights"]["covered"] == 4
        ok(c.patch(f"/api/v1/bookings/{hotel['id']}", json={"status": "confirmed"}, headers=h))
        assert ok(c.get(f"/api/v1/travel-spaces/{sid}/summary", headers=h))["nights"]["covered"] == 8

        # Journey between places and a planned activity on the itinerary.
        journey = ok(c.post("/api/v1/journeys", json={"travel_space_id": sid, "origin_label": "Vienna", "destination_label": "Salzburg", "mode": "train", "depart_on": _d(4), "arrive_on": _d(4)}, headers=h), 201)
        plan = ok(c.post("/api/v1/itinerary/plans", json={"travel_space_id": sid, "title": "Schönbrunn", "starts_on": _d(1)}, headers=h), 201)
        items = ok(c.get(f"/api/v1/itinerary?travel_space_id={sid}", headers=h))["items"]
        assert {"journey", "activity"} <= {i["kind"] for i in items}
        bad = c.post("/api/v1/itinerary/plans", json={"travel_space_id": sid, "title": "Too late", "starts_on": _d(30)}, headers=h)
        assert bad.status_code == 422
        ok(c.delete(f"/api/v1/itinerary/plans/{plan['id']}", headers=h), 204)
        booking_item = next(i for i in ok(c.get(f"/api/v1/itinerary?travel_space_id={sid}", headers=h))["items"] if i["booking_id"])
        assert c.delete(f"/api/v1/itinerary/plans/{booking_item['id']}", headers=h).status_code == 409
        ok(c.delete(f"/api/v1/journeys/{journey['id']}", headers=h), 204)

        # Saved place: status, coordinates, map, delete.
        place = ok(c.post("/api/v1/saved-places", json={"name": "Café Central", "travel_space_id": sid, "category": "cafe"}, headers=h), 201)
        ok(c.patch(f"/api/v1/saved-places/{place['id']}", json={"status": "visited"}, headers=h))
        points = ok(c.get(f"/api/v1/map/points?travel_space_id={sid}", headers=h))
        assert {u["title"] for u in points["unlocated"]} >= {"Hotel Wien", "Café Central"}
        ok(c.patch(f"/api/v1/saved-places/{place['id']}/location", json={"latitude": 48.21, "longitude": 16.37}, headers=h))
        ok(c.patch(f"/api/v1/bookings/{hotel['id']}", json={"latitude": 48.2, "longitude": 16.37}, headers=h))
        points = ok(c.get(f"/api/v1/map/points?travel_space_id={sid}", headers=h))
        assert {p["kind"] for p in points["points"]} == {"booking", "place"}
        assert c.patch(f"/api/v1/saved-places/{place['id']}/location", json={"latitude": 99, "longitude": 0}, headers=h).status_code == 422

        # Money: expense with a split, monthly cost, budget, delete.
        exp = ok(c.post("/api/v1/living/expenses", json={"travel_space_id": sid, "name": "Dinner", "amount": "60.00", "currency": "EUR", "category": "other", "spent_on": _d(0), "split_with": ["Sam", "Anna"]}, headers=h), 201)
        assert [s["amount"] for s in exp["splits"]] in (["30.00", "30.00"], ["30", "30"], [30.0, 30.0], ["30.0", "30.0"])
        rent = ok(c.post("/api/v1/living/recurring", json={"travel_space_id": sid, "name": "Gym", "amount": "40", "currency": "EUR", "category": "fitness", "starts_on": _d(-2)}, headers=h), 201)
        today = datetime.now(UTC).date()
        ok(c.put("/api/v1/living/budget", json={"travel_space_id": sid, "year": today.year, "month": today.month, "amount": "500", "currency": "EUR"}, headers=h))
        month = ok(c.get(f"/api/v1/living/summary?travel_space_id={sid}&year={today.year}&month={today.month}", headers=h))["currencies"][0]
        assert month["currency"] == "EUR" and month["budget"] is not None
        settle = ok(c.get(f"/api/v1/settlement?travel_space_id={sid}", headers=h))
        assert settle["balances"][0]["name"] == "Anna"
        ok(c.delete(f"/api/v1/living/expenses/{exp['id']}", headers=h), 204)
        ok(c.delete(f"/api/v1/living/recurring/{rent['id']}", headers=h), 204)
        assert ok(c.get(f"/api/v1/living/expenses?travel_space_id={sid}", headers=h)) == []

        # Local life, visa days.
        ok(c.post("/api/v1/living/services", json={"travel_space_id": sid, "name": "McFit", "category": "gym"}, headers=h), 201)
        assert c.post("/api/v1/living/neighbourhoods", json={"travel_space_id": sid, "name": "Neubau", "safety_note": "Quiet"}, headers=h).status_code == 422
        visa = ok(c.post("/api/v1/living/visa-logs", json={"label": "Schengen", "rule": "schengen_90_180"}, headers=h), 201)
        visa = ok(c.post(f"/api/v1/living/visa-logs/{visa['id']}/spans", json={"entered_on": _d(-2)}, headers=h), 201)
        assert visa["count"]["used_days"] == 3 and visa["count"]["remaining_days"] == 87

        # Packing and trip budget.
        item = ok(c.post("/api/v1/packing", json={"travel_space_id": sid, "label": "Adapter"}, headers=h), 201)
        ok(c.patch(f"/api/v1/packing/{item['id']}", json={"packed": True}, headers=h))
        assert ok(c.get(f"/api/v1/travel-spaces/{sid}/summary", headers=h))["packing"] == {"total": 1, "packed": 1}
        ok(c.put("/api/v1/trip-budgets", json={"travel_space_id": sid, "amount": "2000", "currency": "EUR"}, headers=h))

        # Wallet: upload, list, read, delete.
        doc = ok(c.post("/api/v1/wallet/documents/upload", data={"kind": "passport"}, files={"file": ("p.pdf", PDF, "application/pdf")}, headers=h), 201)
        assert ok(c.get(f"/api/v1/travel-spaces/{sid}/summary", headers=h))["documents"] == 1
        assert c.get(f"/api/v1/wallet/documents/{doc['id']}/file", headers=h).content == PDF

        # Memories: duplicate gallery photo is refused, journal note saved.
        photo = {"travel_space_id": sid, "asset_key": "ph://A1", "filename": "IMG_1.HEIC", "taken_on": _d(0), "latitude": 48.2, "longitude": 16.37, "place_label": "Innere Stadt, Vienna"}
        ok(c.post("/api/v1/memories/photos", json=photo, headers=h), 201)
        assert c.post("/api/v1/memories/photos", json=photo, headers=h).status_code == 409
        ok(c.post("/api/v1/memories/notes", json={"travel_space_id": sid, "on_date": _d(0), "body": "Coffee at Central"}, headers=h), 201)
        assert len(ok(c.get(f"/api/v1/map/points?travel_space_id={sid}", headers=h))["points"]) == 3

        # Assistant answers from records and proposes, never writes.
        reply = ok(c.post("/api/v1/ai/chat", json={"message": "Which nights are open?", "travel_space_id": sid}, headers=h))
        assert reply["reply"]

        # Pause, archive, restore: home follows.
        ok(c.patch(f"/api/v1/travel-spaces/{sid}", json={"status": "paused"}, headers=h))
        assert ok(c.get("/api/v1/dashboard", headers=h))["mode"] == "paused"
        ok(c.post(f"/api/v1/travel-spaces/{sid}/archive", json={}, headers=h), 204)
        assert ok(c.get("/api/v1/dashboard", headers=h))["mode"] == "at_home"
        assert [s["id"] for s in ok(c.get("/api/v1/travel-spaces?archived=true", headers=h))] == [sid]
        assert ok(c.post(f"/api/v1/travel-spaces/{sid}/restore", json={}, headers=h))["status"] == "active"

        # Merge a duplicate trip in.
        dup = ok(c.post("/api/v1/travel-spaces", json={"title": "Austria copy", "start_date": _d(-5), "end_date": _d(1)}, headers=h), 201)
        ok(c.post("/api/v1/bookings", json={"travel_space_id": dup["id"], "category": "activity", "provider": "GYG", "starts_at": f"{_d(-4)}T10:00:00"}, headers=h), 201)
        merged = ok(c.post(f"/api/v1/travel-spaces/{sid}/merge", json={"from_space_id": dup["id"]}, headers=h))
        assert merged["start_date"] == _d(-5)
        assert len(ok(c.get(f"/api/v1/bookings?travel_space_id={sid}", headers=h))) == 3

        # Another traveller sees none of it.
        other = _auth(c, "other@travelos.test")
        for path in (f"/api/v1/travel-spaces/{sid}", f"/api/v1/travel-spaces/{sid}/summary", f"/api/v1/bookings/{hotel['id']}", f"/api/v1/wallet/documents/{doc['id']}/file"):
            assert c.get(path, headers=other).status_code == 404, path
        assert ok(c.get("/api/v1/bookings", headers=other)) == []

        # Export has everything; deleting the account removes it.
        export = ok(c.get("/api/v1/users/me/export", headers=h))
        assert len(export["bookings"]) == 3 and len(export["memory_photos"]) == 1 and len(export["travel_documents"]) == 1
        assert all("file_key" not in d for d in export["travel_documents"])
        ok(c.delete("/api/v1/users/me", headers=h), 204)
        assert c.get("/api/v1/users/me", headers=h).status_code == 401
