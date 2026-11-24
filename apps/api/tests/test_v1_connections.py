import io
import os
import tempfile
from datetime import UTC, datetime, timedelta

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

CONFIRMATION = """
Booking confirmation
Confirmation number: 44119988
Check-in January 4, 2027
Check-out January 6, 2027
MEININGER Hotel
"""


def _client() -> TestClient:
    return TestClient(create_app())


def _auth(client: TestClient, email: str = "ada@travelos.test") -> dict[str, str]:
    token = client.post(
        "/api/v1/auth/dev-login", json={"email": email, "display_name": "Ada"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


SECRET = {"X-Inbound-Secret": "inbound-test-secret"}


def _inbound_on(monkeypatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "inbound_email_domain", "in.example.test")
    monkeypatch.setattr(get_settings(), "inbound_email_secret", "inbound-test-secret")


def test_forwarding_is_hidden_until_a_receiving_domain_is_set_up():
    with _client() as client:
        headers = _auth(client, "noforward@travelos.test")
        body = client.get("/api/v1/users/me/forwarding", headers=headers).json()
        assert body == {"address": None, "available": False}
        refused = client.post("/api/v1/emails/inbound", json={"to": "trips+x@in.example.test", "text": "x"})
        assert refused.status_code == 404


def test_forwarding_address_imports_a_confirmation(monkeypatch):
    _inbound_on(monkeypatch)
    with _client() as client:
        headers = _auth(client, "forward@travelos.test")
        address = client.get("/api/v1/users/me/forwarding", headers=headers).json()["address"]
        assert address.startswith("trips+") and address.endswith("@in.example.test")

        no_secret = client.post(
            "/api/v1/emails/inbound",
            json={"to": address, "subject": "Booking confirmation", "text": CONFIRMATION},
        )
        assert no_secret.status_code == 401

        imported = client.post(
            "/api/v1/emails/inbound",
            json={"to": address, "subject": "Booking confirmation", "text": CONFIRMATION},
            headers=SECRET,
        )
        assert imported.status_code == 200
        body = imported.json()
        assert body["status"] == "imported"
        assert body["booking_id"]

        unknown = client.post(
            "/api/v1/emails/inbound",
            json={"to": "trips+00000000000000000000000000000000@in.example.test", "subject": "x", "text": "x"},
            headers=SECRET,
        )
        assert unknown.status_code == 404


def test_pdf_upload_files_a_booking_on_the_space():
    with _client() as client:
        headers = _auth(client, "pdf@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Germany", "start_date": "2027-01-01", "end_date": "2027-01-31"},
            headers=headers,
        ).json()
        uploaded = client.post(
            "/api/v1/documents",
            headers=headers,
            files={"file": ("confirm.txt", io.BytesIO(CONFIRMATION.encode()), "text/plain")},
            data={"travel_space_id": space["id"]},
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["status"] == "imported"
        bookings = client.get(f"/api/v1/bookings?travel_space_id={space['id']}", headers=headers).json()
        assert len(bookings) == 1
        assert bookings[0]["confirmation_reference"] == "44119988"


def test_dismissing_a_gap_hides_it_and_keeps_the_bookings():
    with _client() as client:
        headers = _auth(client, "gap@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Gap", "start_date": "2027-01-03", "end_date": "2027-01-09"},
            headers=headers,
        ).json()
        for start, end in (("2027-01-03T15:00:00", "2027-01-05T11:00:00"), ("2027-01-07T15:00:00", "2027-01-09T11:00:00")):
            client.post(
                "/api/v1/bookings",
                json={
                    "travel_space_id": space["id"],
                    "category": "accommodation",
                    "provider": "Hotel",
                    "starts_at": start,
                    "ends_at": end,
                    "status": "confirmed",
                },
                headers=headers,
            )
        before = client.get(f"/api/v1/travel-spaces/{space['id']}/coverage", headers=headers).json()
        assert before["gaps"]
        key = before["gaps"][0]["start"]
        assert client.post(
            f"/api/v1/travel-spaces/{space['id']}/prompts/dismiss",
            json={"kind": "gap", "key": key},
            headers=headers,
        ).status_code == 204
        after = client.get(f"/api/v1/travel-spaces/{space['id']}/coverage", headers=headers).json()
        assert all(gap["start"] != key for gap in after["gaps"])
        assert len(client.get(f"/api/v1/bookings?travel_space_id={space['id']}", headers=headers).json()) == 2


def test_preferences_save_currency_timezone_and_notifications():
    with _client() as client:
        headers = _auth(client, "prefs@travelos.test")
        current = client.get("/api/v1/preferences", headers=headers).json()
        current.update({"home_currency": "EUR", "timezone": "Europe/Berlin", "notifications_enabled": False})
        saved = client.put("/api/v1/preferences", json=current, headers=headers)
        assert saved.status_code == 200
        assert saved.json()["home_currency"] == "EUR"
        assert saved.json()["timezone"] == "Europe/Berlin"
        assert saved.json()["notifications_enabled"] is False


def test_reminder_for_a_flight_tomorrow():
    with _client() as client:
        headers = _auth(client, "remind@travelos.test")
        space = client.post("/api/v1/travel-spaces", json={"title": "Soon"}, headers=headers).json()
        tomorrow = (datetime.now(UTC) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        client.post(
            "/api/v1/bookings",
            json={
                "travel_space_id": space["id"],
                "category": "flight",
                "provider": "Cleartrip",
                "location_label": "Munich",
                "starts_at": tomorrow.isoformat(),
                "status": "confirmed",
            },
            headers=headers,
        )
        reminders = client.get("/api/v1/reminders", headers=headers).json()
        assert any(item["kind"] == "flight_tomorrow" and "Munich" in item["body"] for item in reminders)


def test_saved_listing_is_not_a_booking_and_a_click_is_recorded():
    with _client() as client:
        headers = _auth(client, "list@travelos.test")
        search = client.get("/api/v1/inventory/search?q=berlin", headers=headers)
        assert search.status_code == 200
        assert search.json()["listings"] == []
        saved = client.post(
            "/api/v1/saved-listings",
            json={"name": "Hostel I found", "url": "https://www.booking.com/hotel/example", "category": "accommodation"},
            headers=headers,
        )
        assert saved.status_code == 201
        opened = client.post(f"/api/v1/saved-listings/{saved.json()['id']}/open", headers=headers)
        assert opened.status_code == 200
        assert opened.json()["url"].startswith("https://")
        assert "does not make the booking" in opened.json()["disclosure"]
        assert client.get("/api/v1/bookings", headers=headers).json() == []


def test_cancellation_email_updates_the_existing_booking(monkeypatch):
    _inbound_on(monkeypatch)
    with _client() as client:
        headers = _auth(client, "cancel@travelos.test")
        address = client.get("/api/v1/users/me/forwarding", headers=headers).json()["address"]
        imported = client.post(
            "/api/v1/emails/inbound",
            json={"to": address, "subject": "Booking confirmation", "text": CONFIRMATION},
            headers=SECRET,
        ).json()
        cancelled = client.post(
            "/api/v1/emails/inbound",
            json={
                "to": address,
                "subject": "Your booking has been cancelled",
                "text": "Confirmation number: 44119988\nYour reservation has been cancelled.",
            },
            headers=SECRET,
        )
        assert cancelled.status_code == 200
        booking = client.get(f"/api/v1/bookings/{imported['booking_id']}", headers=headers).json()
        assert booking["status"] == "cancelled"


def test_assistant_names_open_nights_without_inventing_a_hotel():
    with _client() as client:
        headers = _auth(client, "nights@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Nights", "start_date": "2027-01-03", "end_date": "2027-01-09"},
            headers=headers,
        ).json()
        client.post(
            "/api/v1/bookings",
            json={
                "travel_space_id": space["id"],
                "category": "accommodation",
                "provider": "Hotel",
                "starts_at": "2027-01-03T15:00:00",
                "ends_at": "2027-01-05T11:00:00",
                "status": "confirmed",
            },
            headers=headers,
        )
        reply = client.post(
            "/api/v1/ai/chat",
            json={"message": "Which nights are open?", "travel_space_id": space["id"]},
            headers=headers,
        ).json()["reply"]
        assert "no stay saved" in reply
        assert "€" not in reply and "hotel" not in reply.lower()

    with _client() as client:
        headers = _auth(client, "ask@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Ask", "start_date": "2027-01-03", "end_date": "2027-01-09"},
            headers=headers,
        ).json()
        client.post(
            "/api/v1/bookings",
            json={
                "travel_space_id": space["id"],
                "category": "accommodation",
                "provider": "Hotel",
                "starts_at": "2027-01-03T15:00:00",
                "ends_at": "2027-01-05T11:00:00",
                "status": "confirmed",
            },
            headers=headers,
        )
        chat = client.post(
            "/api/v1/ai/chat",
            json={"message": "I'm staying with Anna", "travel_space_id": space["id"]},
            headers=headers,
        ).json()
        proposal = chat["proposal"]
        assert proposal["kind"] == "add_stay"
        assert proposal["title"] == "Anna"
        created = client.post(
            "/api/v1/stays",
            json={
                "travel_space_id": proposal["travel_space_id"],
                "title": proposal["title"],
                "start_date": proposal["start_date"],
                "end_date": proposal["end_date"],
            },
            headers=headers,
        )
        assert created.status_code == 201
        coverage = client.get(f"/api/v1/travel-spaces/{space['id']}/coverage", headers=headers).json()
        assert any(night["status"] == "own_stay" and night["title"] == "Anna" for night in coverage["nights"])


def test_planned_item_needs_confirmation_and_is_not_a_booking():
    with _client() as client:
        headers = _auth(client, "plan@travelos.test")
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Plan", "start_date": "2027-03-01", "end_date": "2027-03-08"},
            headers=headers,
        ).json()
        outside = client.post(
            "/api/v1/ai/chat",
            json={"message": "Add a museum on 2027-04-01", "travel_space_id": space["id"]},
            headers=headers,
        ).json()
        assert outside["proposal"] is None
        assert "outside this trip" in outside["reply"]
        chat = client.post(
            "/api/v1/ai/chat",
            json={"message": "Add a museum on 2027-03-04", "travel_space_id": space["id"]},
            headers=headers,
        ).json()
        proposal = chat["proposal"]
        assert proposal["kind"] == "add_plan"
        assert proposal["title"] == "a museum"
        assert "not a confirmed booking" in chat["reply"]
        saved = client.post(
            "/api/v1/itinerary/plans",
            json={
                "travel_space_id": proposal["travel_space_id"],
                "title": proposal["title"],
                "starts_on": proposal["starts_on"],
            },
            headers=headers,
        )
        assert saved.status_code == 201
        assert saved.json()["status"] == "planned"
        assert client.get("/api/v1/bookings", headers=headers).json() == []
        place = client.post(
            "/api/v1/ai/chat",
            json={"message": "Save place River market", "travel_space_id": space["id"]},
            headers=headers,
        ).json()["proposal"]
        assert place["kind"] == "save_place"
        created = client.post(
            "/api/v1/saved-places",
            json={"name": place["title"], "travel_space_id": place["travel_space_id"]},
            headers=headers,
        )
        assert created.status_code == 201
        ideas = client.post(
            "/api/v1/ai/chat",
            json={"message": "Find a gym near my apartment", "travel_space_id": space["id"]},
            headers=headers,
        ).json()
        assert ideas["proposal"] is None
        assert "won't invent" in ideas["reply"]


def test_reminders_are_stored_as_notifications():
    with _client() as client:
        headers = _auth(client, "note@travelos.test")
        tomorrow = (datetime.now(UTC) + timedelta(days=1)).date().isoformat()
        client.post(
            "/api/v1/bookings",
            json={
                "category": "flight",
                "provider": "Cleartrip",
                "starts_at": f"{tomorrow}T09:40:00",
                "status": "confirmed",
                "location_label": "HKG to MUC",
            },
            headers=headers,
        )
        reminders = client.get("/api/v1/reminders", headers=headers).json()
        assert any(note["kind"] == "flight_tomorrow" for note in reminders)
        notes = client.get("/api/v1/notifications", headers=headers).json()
        assert any(note["kind"] == "flight_tomorrow" and note["read_at"] is None for note in notes)
        client.get("/api/v1/reminders", headers=headers)
        again = client.get("/api/v1/notifications", headers=headers).json()
        assert len(again) == len(notes)

