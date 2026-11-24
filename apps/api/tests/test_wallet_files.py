import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def _auth(client, email):
    token = client.post("/api/v1/auth/dev-login", json={"email": email, "display_name": "W"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_upload_view_and_delete_a_passport_scan(monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", tempfile.mkdtemp())
    with TestClient(create_app()) as client:
        h = _auth(client, "wallet@travelos.test")
        doc = client.post(
            "/api/v1/wallet/documents/upload",
            data={"kind": "international_driving_permit"},
            files={"file": ("idp.pdf", PDF, "application/pdf")},
            headers=h,
        )
        assert doc.status_code == 201, doc.text
        body = doc.json()
        assert body["title"] == "International Driving Permit" and body["has_file"] is True
        assert body["content_type"] == "application/pdf"

        got = client.get(f"/api/v1/wallet/documents/{body['id']}/file", headers=h)
        assert got.status_code == 200 and got.content == PDF

        other = _auth(client, "stranger@travelos.test")
        assert client.get(f"/api/v1/wallet/documents/{body['id']}/file", headers=other).status_code == 404

        bad = client.post(
            "/api/v1/wallet/documents/upload",
            data={"kind": "passport"},
            files={"file": ("x.exe", b"MZ\x90\x00binary", "application/pdf")},
            headers=h,
        )
        assert bad.status_code == 415

        assert client.delete(f"/api/v1/wallet/documents/{body['id']}", headers=h).status_code == 204
        assert client.get(f"/api/v1/wallet/documents/{body['id']}/file", headers=h).status_code == 404
