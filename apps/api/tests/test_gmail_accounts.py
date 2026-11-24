import os
import tempfile
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

import httpx  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

# Fake Google: each authorization code belongs to one inbox.
INBOXES = {"code-a": ("refresh-a", "access-a"), "code-b": ("refresh-b", "access-b")}
ADDRESSES = {"access-a": "Traveller@gmail.com", "access-b": "work.trips@gmail.com"}
REFRESHED = {"refresh-a": "access-a", "refresh-b": "access-b"}
REVOKED: set[str] = set()


def _response(url: str, status: int, body: dict) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("GET", url))


def fake_post(url, data=None, **_kw):
    if url.endswith("/revoke"):
        return _response(url, 200, {})
    if data["grant_type"] == "authorization_code":
        refresh, access = INBOXES[data["code"]]
        return _response(url, 200, {"refresh_token": refresh, "access_token": access})
    if data["refresh_token"] in REVOKED:
        return _response(url, 400, {"error": "invalid_grant"})
    return _response(url, 200, {"access_token": REFRESHED[data["refresh_token"]]})


def fake_get(url, headers=None, params=None, **_kw):
    access = headers["Authorization"].removeprefix("Bearer ")
    if url.endswith("/profile"):
        return _response(url, 200, {"emailAddress": ADDRESSES[access]})
    return _response(url, 200, {"messages": []})


def _connect(client: TestClient, h: dict, code: str) -> None:
    url = client.post("/api/v1/integrations/gmail/connect", json={}, headers=h).json()["authorization_url"]
    query = parse_qs(urlparse(url).query)
    assert "select_account" in query["prompt"][0]
    page = client.get("/api/v1/integrations/gmail/callback", params={"state": query["state"][0], "code": code})
    assert "Gmail is connected" in page.text


def test_several_gmail_accounts_connect_sync_and_disconnect(monkeypatch):
    from app.core.config import get_settings
    from app.services import gmail

    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "client")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(gmail.httpx, "post", fake_post)
    monkeypatch.setattr(gmail.httpx, "get", fake_get)

    with TestClient(create_app()) as client:
        token = client.post(
            "/api/v1/auth/dev-login", json={"email": "two-inboxes@travelos.test", "display_name": "T"}
        ).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        status = client.get("/api/v1/integrations/gmail", headers=h).json()
        assert status["status"] == "disconnected" and status["accounts"] == []

        _connect(client, h, "code-a")
        _connect(client, h, "code-b")
        _connect(client, h, "code-a")  # reconnecting the same inbox does not add a second row

        status = client.get("/api/v1/integrations/gmail", headers=h).json()
        assert status["status"] == "connected"
        assert [a["email"] for a in status["accounts"]] == ["traveller@gmail.com", "work.trips@gmail.com"]

        assert client.post("/api/v1/integrations/gmail/sync", headers=h).status_code == 200
        synced = client.get("/api/v1/integrations/gmail", headers=h).json()["accounts"]
        assert all(account["last_synced_at"] for account in synced)

        # One inbox loses access: the other still syncs, the broken one asks to reconnect.
        REVOKED.add("refresh-b")
        assert client.post("/api/v1/integrations/gmail/sync", headers=h).status_code == 200
        accounts = {a["email"]: a for a in client.get("/api/v1/integrations/gmail", headers=h).json()["accounts"]}
        assert accounts["work.trips@gmail.com"]["status"] == "error"
        assert accounts["traveller@gmail.com"]["status"] == "connected"
        REVOKED.clear()

        # Disconnect one; the other stays connected.
        first = accounts["traveller@gmail.com"]["id"]
        assert client.delete(f"/api/v1/integrations/gmail/{first}", headers=h).status_code == 204
        left = client.get("/api/v1/integrations/gmail", headers=h).json()
        assert [a["email"] for a in left["accounts"]] == ["work.trips@gmail.com"]
        assert client.delete(f"/api/v1/integrations/gmail/{first}", headers=h).status_code == 404

        # Another person cannot disconnect someone else's inbox.
        other = client.post(
            "/api/v1/auth/dev-login", json={"email": "someone@travelos.test", "display_name": "S"}
        ).json()["access_token"]
        second = left["accounts"][0]["id"]
        response = client.delete(f"/api/v1/integrations/gmail/{second}", headers={"Authorization": f"Bearer {other}"})
        assert response.status_code == 404

        assert client.delete("/api/v1/integrations/gmail", headers=h).status_code == 204
        assert client.get("/api/v1/integrations/gmail", headers=h).json()["status"] == "disconnected"
        assert client.post("/api/v1/integrations/gmail/sync", headers=h).status_code == 409
