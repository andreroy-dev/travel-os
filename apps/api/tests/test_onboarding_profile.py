import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


def _login(client, email="onb@travelos.test"):
    token = client.post("/api/v1/auth/dev-login", json={"email": email, "display_name": "O"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_profile_fields_save_normalise_and_complete_onboarding():
    with TestClient(create_app()) as client:
        h = _login(client)
        assert client.get("/api/v1/preferences", headers=h).json()["onboarding_complete"] is False
        body = {
            "home_country": "in",
            "residency_country": "de",
            "passport_nationality": "in",
            "trip_type": "living_abroad",
            "pace": "relaxed",
            "provider_priority": "destination",
        }
        saved = client.put("/api/v1/preferences", json=body, headers=h)
        assert saved.status_code == 200, saved.text
        data = saved.json()
        assert (data["home_country"], data["residency_country"], data["passport_nationality"]) == ("IN", "DE", "IN")
        assert data["onboarding_complete"] is True
        assert client.get("/api/v1/preferences", headers=h).json()["trip_type"] == "living_abroad"


def test_rejects_bad_values():
    with TestClient(create_app()) as client:
        h = _login(client, "bad@travelos.test")
        for bad in ({"home_country": "India"}, {"trip_type": "cruise"}, {"pace": "fast"}, {"provider_priority": "x"}):
            assert client.put("/api/v1/preferences", json=bad, headers=h).status_code == 422


def test_older_app_build_does_not_wipe_profile():
    with TestClient(create_app()) as client:
        h = _login(client, "old@travelos.test")
        client.put("/api/v1/preferences", json={"passport_nationality": "US", "home_country": "US"}, headers=h)
        # An older client only knows the original fields.
        client.put("/api/v1/preferences", json={"home_currency": "EUR", "timezone": "Europe/Berlin"}, headers=h)
        data = client.get("/api/v1/preferences", headers=h).json()
        assert data["home_currency"] == "EUR" and data["passport_nationality"] == "US"
