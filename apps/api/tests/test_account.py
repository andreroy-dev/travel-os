import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


def _client() -> TestClient:
    return TestClient(create_app())


def test_export_then_delete_removes_everything():
    with _client() as client:
        token = client.post(
            "/api/v1/auth/dev-login", json={"email": "del@travelos.test", "display_name": "Del"}
        ).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        space = client.post("/api/v1/travel-spaces", json={"title": "T"}, headers=h).json()
        client.post(
            "/api/v1/bookings",
            json={"travel_space_id": space["id"], "category": "activity", "provider": "X"},
            headers=h,
        )
        client.post("/api/v1/saved-places", json={"name": "Cafe", "travel_space_id": space["id"]}, headers=h)

        export = client.get("/api/v1/users/me/export", headers=h).json()
        assert export["user"]["email"] == "del@travelos.test"
        assert len(export["bookings"]) == 1 and len(export["saved_places"]) == 1
        assert all("token_ciphertext" not in row for row in export["integrations"])

        assert client.delete("/api/v1/users/me", headers=h).status_code == 204
        assert client.get("/api/v1/users/me", headers=h).status_code == 401

        again = client.post(
            "/api/v1/auth/dev-login", json={"email": "del@travelos.test", "display_name": "Del"}
        ).json()["access_token"]
        h2 = {"Authorization": f"Bearer {again}"}
        assert client.get("/api/v1/travel-spaces", headers=h2).json() == []
        assert client.get("/api/v1/bookings", headers=h2).json() == []


def test_first_supabase_sign_in_links_existing_account_by_email(monkeypatch):
    import time

    import jwt

    from app.core.config import get_settings

    secret = "s" * 40
    monkeypatch.setattr(get_settings(), "supabase_jwt_secret", secret)
    with _client() as client:
        dev = client.post(
            "/api/v1/auth/dev-login", json={"email": "link@travelos.test", "display_name": "L"}
        ).json()["access_token"]
        h = {"Authorization": f"Bearer {dev}"}
        client.post("/api/v1/travel-spaces", json={"title": "Germany"}, headers=h)

        supa = jwt.encode(
            {
                "sub": "supabase-user-1",
                "aud": "authenticated",
                "email": "Link@travelos.test",
                "exp": int(time.time()) + 600,
            },
            secret,
            algorithm="HS256",
        )
        hs = {"Authorization": f"Bearer {supa}"}
        assert client.get("/api/v1/users/me", headers=hs).json()["email"] == "link@travelos.test"
        assert [s["title"] for s in client.get("/api/v1/travel-spaces", headers=hs).json()] == ["Germany"]

        wrong_aud = jwt.encode(
            {"sub": "x", "aud": "anon", "email": "a@b.co", "exp": int(time.time()) + 600},
            secret,
            algorithm="HS256",
        )
        assert client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {wrong_aud}"}).status_code == 401
