import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/memories.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


def _client() -> TestClient:
    return TestClient(create_app())


def test_a_chosen_photo_is_metadata_only_and_a_recap_uses_the_caption():
    with _client() as client:
        token = client.post(
            "/api/v1/auth/dev-login", json={"email": "photos@travelos.test", "display_name": "Ada"}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        space = client.post(
            "/api/v1/travel-spaces",
            json={"title": "Munich", "start_date": "2026-12-29", "end_date": "2027-01-06"},
            headers=headers,
        ).json()
        photo = client.post(
            "/api/v1/memories/photos",
            json={
                "travel_space_id": space["id"],
                "asset_key": "library-photo-1",
                "filename": "station.jpg",
                "taken_on": "2026-12-30",
                "latitude": 48.14,
                "longitude": 11.58,
                "caption": "Outside the station",
                "place_label": "Munich",
                "album": "Arrival",
            },
            headers=headers,
        )
        assert photo.status_code == 201
        again = client.post(
            "/api/v1/memories/photos",
            json={
                "travel_space_id": space["id"],
                "asset_key": "library-photo-1",
                "filename": "station.jpg",
            },
            headers=headers,
        )
        assert again.status_code == 409
        note = client.post(
            "/api/v1/memories/notes",
            json={"travel_space_id": space["id"], "on_date": "2026-12-30", "body": "Landed late."},
            headers=headers,
        )
        assert note.status_code == 201
        listed = client.get(f"/api/v1/memories?travel_space_id={space['id']}", headers=headers).json()
        assert listed["photos"][0]["caption"] == "Outside the station"
        assert listed["located"][0]["latitude"] == 48.14
        assert "map provider is not connected" in listed["map_note"]
        reply = client.post(
            "/api/v1/ai/chat",
            json={"message": "Give me a recap", "travel_space_id": space["id"]},
            headers=headers,
        ).json()["reply"]
        assert "Outside the station" in reply
        assert "Landed late." in reply
        assert "landmark" not in reply.lower()
