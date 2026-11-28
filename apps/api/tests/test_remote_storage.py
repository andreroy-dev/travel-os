import json
import uuid

import httpx
import pytest

from app.core.config import get_settings
from app.core.errors import AppError
from app.services import document_files

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF"


@pytest.fixture
def fake_supabase(monkeypatch):
    """An in-memory stand-in for the Supabase Storage REST API."""
    cfg = get_settings()
    monkeypatch.setattr(cfg, "supabase_url", "https://x.supabase.co")
    monkeypatch.setattr(cfg, "supabase_service_key", "service-key")
    store: dict[str, bytes] = {}
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if request.method == "POST" and "/object/list/" in path:
            prefix = json.loads(request.read())["prefix"]
            return httpx.Response(200, json=[{"name": k.split("/")[1]} for k in store if k.startswith(prefix)])
        if request.method == "DELETE" and path.endswith("/object/documents"):
            for name in json.loads(request.read())["prefixes"]:
                store.pop(name, None)
            return httpx.Response(200, json=[])
        key = path.split("/object/documents/")[-1]
        if request.method == "POST":
            store[key] = request.read()
            return httpx.Response(200, json={})
        if request.method == "GET":
            return httpx.Response(200, content=store[key]) if key in store else httpx.Response(404)
        if request.method == "DELETE":
            store.pop(key, None)
            return httpx.Response(200, json={})
        return httpx.Response(400)

    transport = httpx.MockTransport(handler)
    for verb in ("post", "get", "delete"):
        monkeypatch.setattr(
            httpx, verb, lambda url, _v=verb, **kw: httpx.Client(transport=transport).request(_v.upper(), url, **kw)
        )
    monkeypatch.setattr(httpx, "request", lambda m, url, **kw: httpx.Client(transport=transport).request(m, url, **kw))
    return store, seen


def test_save_read_delete_round_trip(fake_supabase):
    store, seen = fake_supabase
    user = uuid.uuid4()
    key, content_type, size = document_files.save(user, PDF, "application/pdf", "p.pdf")
    assert content_type == "application/pdf" and size == len(PDF) and key.startswith(user.hex)
    assert store[key] == PDF
    assert seen[0].headers["authorization"] == "Bearer service-key"
    assert document_files.read(key) == PDF
    document_files.delete(key)
    assert key not in store
    with pytest.raises(AppError) as err:
        document_files.read(key)
    assert err.value.status_code == 404


def test_delete_all_removes_only_that_users_files(fake_supabase):
    store, _ = fake_supabase
    mine, other = uuid.uuid4(), uuid.uuid4()
    document_files.save(mine, PDF, None, "a.pdf")
    document_files.save(mine, PDF, None, "b.pdf")
    keep, *_ = document_files.save(other, PDF, None, "c.pdf")
    document_files.delete_all(mine)
    assert list(store) == [keep]


def test_storage_outage_is_a_clean_error(monkeypatch):
    cfg = get_settings()
    monkeypatch.setattr(cfg, "supabase_url", "https://x.supabase.co")
    monkeypatch.setattr(cfg, "supabase_service_key", "k")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(500))
    with pytest.raises(AppError) as err:
        document_files.save(uuid.uuid4(), PDF, None, "p.pdf")
    assert err.value.status_code == 502
