"""Who is on a trip, what they may do, and leaving a trip.

Adding people happens through invites (Phase 5). Here: list, change a role,
remove, leave. When someone leaves or is removed they keep personal copies of
the bookings they brought in; the originals stay on the trip.
"""

from uuid import UUID

from fastapi import APIRouter, Response
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.permissions import Role, require_space, role_in_space
from app.core.errors import AppError
from app.models import Booking, TravelSpace, TripMember, User

router = APIRouter()

ASSIGNABLE = {Role.editor, Role.contributor, Role.viewer}


class MemberOut(BaseModel):
    user_id: UUID
    display_name: str
    email: str
    role: Role
    is_you: bool


class RoleIn(BaseModel):
    role: Role


COPY_FIELDS = (
    "category", "provider", "confirmation_reference", "status", "source", "starts_at", "ends_at",
    "timezone", "location_label", "latitude", "longitude", "price_amount", "price_currency",
    "cancellation_policy", "notes", "details", "source_channel", "sender_domain", "booking_url",
)


def keep_personal_copies(session, space: TravelSpace, user_id: UUID) -> int:
    """Copy the leaver's own bookings out of the trip. The originals stay on the
    trip and pass to its owner, so the leaver no longer sees them as theirs."""
    space_id = space.id
    bookings = session.scalars(
        select(Booking).where(Booking.travel_space_id == space_id, Booking.user_id == user_id)
    ).all()
    for b in bookings:
        session.add(
            Booking(
                user_id=user_id,
                travel_space_id=None,
                dedup_key=None,
                **{f: getattr(b, f) for f in COPY_FIELDS},
            )
        )
        b.user_id = space.user_id
    return len(bookings)


@router.get("/travel-spaces/{space_id}/members", response_model=list[MemberOut])
def list_members(space_id: UUID, user: CurrentUser, session: DbSession) -> list[MemberOut]:
    space = require_space(session, space_id, user.id, Role.viewer)
    rows = session.execute(
        select(TripMember, User).join(User, User.id == TripMember.user_id).where(
            TripMember.travel_space_id == space.id
        )
    ).all()
    out = {m.user_id: (m.role, u) for m, u in rows}
    if space.user_id not in out:  # creator without a member row
        creator = session.get(User, space.user_id)
        out[space.user_id] = (Role.owner, creator)
    order = {Role.owner: 0, Role.editor: 1, Role.contributor: 2, Role.viewer: 3}
    items = sorted(out.items(), key=lambda kv: (order[kv[1][0]], kv[1][1].display_name))
    return [
        MemberOut(
            user_id=uid,
            display_name=u.display_name,
            email=u.email,
            role=Role.owner if uid == space.user_id else role,
            is_you=uid == user.id,
        )
        for uid, (role, u) in items
    ]


def _member(session, space: TravelSpace, member_id: UUID) -> TripMember:
    if member_id == space.user_id:
        raise AppError(400, "The trip owner cannot be changed or removed.")
    member = session.scalar(
        select(TripMember).where(TripMember.travel_space_id == space.id, TripMember.user_id == member_id)
    )
    if member is None:
        raise AppError(404, "Not found.")
    return member


@router.patch("/travel-spaces/{space_id}/members/{member_id}", response_model=MemberOut)
def change_role(space_id: UUID, member_id: UUID, payload: RoleIn, user: CurrentUser, session: DbSession) -> MemberOut:
    space = require_space(session, space_id, user.id, Role.owner)
    if payload.role not in ASSIGNABLE:
        raise AppError(422, "Choose editor, contributor or viewer.")
    member = _member(session, space, member_id)
    member.role = payload.role
    session.commit()
    target = session.get(User, member_id)
    return MemberOut(
        user_id=member_id, display_name=target.display_name, email=target.email,
        role=member.role, is_you=member_id == user.id,
    )


@router.delete("/travel-spaces/{space_id}/members/{member_id}", status_code=204)
def remove_member(space_id: UUID, member_id: UUID, user: CurrentUser, session: DbSession) -> Response:
    space = require_space(session, space_id, user.id, Role.owner)
    member = _member(session, space, member_id)
    keep_personal_copies(session, space, member_id)
    session.delete(member)
    session.commit()
    return Response(status_code=204)


@router.post("/travel-spaces/{space_id}/leave", status_code=204)
def leave_trip(space_id: UUID, user: CurrentUser, session: DbSession) -> Response:
    space = require_space(session, space_id, user.id, Role.viewer)
    if role_in_space(session, space, user.id) == Role.owner:
        raise AppError(400, "The owner cannot leave the trip. Delete or archive it instead.")
    member = _member(session, space, user.id)
    keep_personal_copies(session, space, user.id)
    session.delete(member)
    session.commit()
    return Response(status_code=204)
