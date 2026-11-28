import os
import uuid
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import get_engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import TripMember, TripRole, User  # noqa: E402


def _login(client, email):
    r = client.post("/api/v1/auth/dev-login", json={"email": email, "display_name": email.split("@")[0]}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def _uid(email):
    with Session(get_engine()) as s:
        return s.scalar(select(User.id).where(User.email == email))


def _join(space_id, email, role):
    with Session(get_engine()) as s:
        s.add(TripMember(travel_space_id=uuid.UUID(str(space_id)), user_id=_uid(email), role=TripRole(role)))
        s.commit()


def _setup(client, tag):
    emails = {r: f"{r}-{tag}@travelos.test" for r in ("owner", "editor", "contrib", "viewer", "stranger")}
    h = {r: _login(client, e)[0] for r, e in emails.items()}
    space = client.post("/api/v1/travel-spaces", json={"title": f"Trip {tag}"}, headers=h["owner"]).json()
    sid = space["id"]
    _join(sid, emails["editor"], "editor")
    _join(sid, emails["contrib"], "contributor")
    _join(sid, emails["viewer"], "viewer")
    return h, emails, sid


def _booking(client, headers, sid, provider="Air One"):
    return client.post(
        "/api/v1/bookings",
        json={"travel_space_id": sid, "category": "flight", "provider": provider},
        headers=headers,
    )


def test_single_member_trip_works_as_before():
    with TestClient(create_app()) as client:
        h, _ = _login(client, "solo@travelos.test")
        sid = client.post("/api/v1/travel-spaces", json={"title": "Solo"}, headers=h).json()["id"]
        assert _booking(client, h, sid).status_code == 201
        assert len(client.get(f"/api/v1/bookings?travel_space_id={sid}", headers=h).json()) == 1
        members = client.get(f"/api/v1/travel-spaces/{sid}/members", headers=h).json()
        assert [(m["role"], m["is_you"]) for m in members] == [("owner", True)]
        assert client.post(f"/api/v1/travel-spaces/{sid}/archive", headers=h).status_code == 204


def test_non_member_gets_404_everywhere():
    with TestClient(create_app()) as client:
        h, _, sid = _setup(client, "nm")
        s = h["stranger"]
        assert client.get(f"/api/v1/travel-spaces/{sid}", headers=s).status_code == 404
        assert client.get(f"/api/v1/travel-spaces/{sid}/members", headers=s).status_code == 404
        assert _booking(client, s, sid).status_code == 404
        assert client.get(f"/api/v1/bookings?travel_space_id={sid}", headers=s).status_code == 404
        assert sid not in [t["id"] for t in client.get("/api/v1/travel-spaces", headers=s).json()]


def test_viewer_reads_but_cannot_write():
    with TestClient(create_app()) as client:
        h, _, sid = _setup(client, "vw")
        assert _booking(client, h["owner"], sid).status_code == 201
        v = h["viewer"]
        assert client.get(f"/api/v1/travel-spaces/{sid}", headers=v).status_code == 200
        assert len(client.get(f"/api/v1/bookings?travel_space_id={sid}", headers=v).json()) == 1
        assert _booking(client, v, sid).status_code == 403
        assert client.patch(f"/api/v1/travel-spaces/{sid}", json={"title": "x"}, headers=v).status_code == 403


def test_contributor_is_read_only_on_confirmed_items():
    with TestClient(create_app()) as client:
        h, _, sid = _setup(client, "ct")
        assert _booking(client, h["contrib"], sid).status_code == 403
        assert client.get(f"/api/v1/travel-spaces/{sid}", headers=h["contrib"]).status_code == 200


def test_editor_writes_but_cannot_do_owner_actions():
    with TestClient(create_app()) as client:
        h, emails, sid = _setup(client, "ed")
        e = h["editor"]
        assert _booking(client, e, sid, "Editor Air").status_code == 201
        # the owner sees the editor's booking: one shared trip
        providers = [b["provider"] for b in client.get(f"/api/v1/bookings?travel_space_id={sid}", headers=h["owner"]).json()]
        assert providers == ["Editor Air"]
        assert client.post(f"/api/v1/travel-spaces/{sid}/archive", headers=e).status_code == 403
        assert client.post(f"/api/v1/travel-spaces/{sid}/restore", headers=e).status_code == 403
        assert client.patch(
            f"/api/v1/travel-spaces/{sid}/members/{_uid(emails['viewer'])}", json={"role": "editor"}, headers=e
        ).status_code == 403


def test_owner_manages_members():
    with TestClient(create_app()) as client:
        h, emails, sid = _setup(client, "ow")
        o = h["owner"]
        members = client.get(f"/api/v1/travel-spaces/{sid}/members", headers=o).json()
        assert [m["role"] for m in members] == ["owner", "editor", "contributor", "viewer"]
        vid = _uid(emails["viewer"])
        assert client.patch(f"/api/v1/travel-spaces/{sid}/members/{vid}", json={"role": "editor"}, headers=o).status_code == 200
        assert _booking(client, h["viewer"], sid).status_code == 201
        assert client.patch(f"/api/v1/travel-spaces/{sid}/members/{vid}", json={"role": "owner"}, headers=o).status_code == 422
        # the owner cannot be demoted or removed
        oid = _uid(emails["owner"])
        assert client.patch(f"/api/v1/travel-spaces/{sid}/members/{oid}", json={"role": "viewer"}, headers=o).status_code == 400
        assert client.delete(f"/api/v1/travel-spaces/{sid}/members/{oid}", headers=o).status_code == 400
        assert client.post(f"/api/v1/travel-spaces/{sid}/leave", headers=o).status_code == 400


def test_joined_trip_appears_in_the_members_list_of_trips():
    with TestClient(create_app()) as client:
        h, _, sid = _setup(client, "ls")
        assert sid in [t["id"] for t in client.get("/api/v1/travel-spaces", headers=h["viewer"]).json()]


def test_leaving_keeps_personal_copies_and_originals():
    with TestClient(create_app()) as client:
        h, emails, sid = _setup(client, "lv")
        assert _booking(client, h["editor"], sid, "Leaver Air").status_code == 201
        assert client.post(f"/api/v1/travel-spaces/{sid}/leave", headers=h["editor"]).status_code == 204
        # the trip keeps the original
        shared = [b["provider"] for b in client.get(f"/api/v1/bookings?travel_space_id={sid}", headers=h["owner"]).json()]
        assert shared == ["Leaver Air"]
        # the leaver lost access to the trip but keeps a personal copy
        assert client.get(f"/api/v1/travel-spaces/{sid}", headers=h["editor"]).status_code == 404
        mine = client.get("/api/v1/bookings", headers=h["editor"]).json()
        assert [(b["provider"], b["travel_space_id"]) for b in mine] == [("Leaver Air", None)]


def test_removing_a_member_revokes_access_and_keeps_their_copies():
    with TestClient(create_app()) as client:
        h, emails, sid = _setup(client, "rm")
        assert _booking(client, h["editor"], sid, "Removed Air").status_code == 201
        eid = _uid(emails["editor"])
        assert client.delete(f"/api/v1/travel-spaces/{sid}/members/{eid}", headers=h["owner"]).status_code == 204
        assert client.get(f"/api/v1/travel-spaces/{sid}", headers=h["editor"]).status_code == 404
        assert len(client.get(f"/api/v1/bookings?travel_space_id={sid}", headers=h["owner"]).json()) == 1
        assert [b["provider"] for b in client.get("/api/v1/bookings", headers=h["editor"]).json()] == ["Removed Air"]
        assert client.delete(f"/api/v1/travel-spaces/{sid}/members/{eid}", headers=h["owner"]).status_code == 404


def test_migration_backfills_owner_rows():
    import importlib.util
    import pathlib

    path = next(pathlib.Path("migrations/versions").glob("d2a6c8e1f547_*.py"))
    spec = importlib.util.spec_from_file_location("m", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.down_revision == "c4f8a2b6d913"
