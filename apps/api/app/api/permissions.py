"""Who may do what on a trip. Every trip-related route goes through here.

Roles rank owner > editor > contributor > viewer. The trip's creator is always
the owner, with or without a member row. Reads need `viewer`; writes need
`editor` unless a route asks for more (owner-only actions pass `Role.owner`).
A person who is not on the trip gets 404, so trip ids are not revealed; a
member whose role is too low gets 403.
"""

import uuid
from contextvars import ContextVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import TravelSpace, TripMember, TripRole

Role = TripRole
RANK = {Role.viewer: 0, Role.contributor: 1, Role.editor: 2, Role.owner: 3}

# Set per request by the middleware in app.main: reads vs writes.
request_is_write: ContextVar[bool] = ContextVar("request_is_write", default=False)


def default_need() -> Role:
    return Role.editor if request_is_write.get() else Role.viewer


def role_in_space(session: Session, space: TravelSpace, user_id: uuid.UUID) -> Role | None:
    if space.user_id == user_id:
        return Role.owner
    return session.scalar(
        select(TripMember.role).where(
            TripMember.travel_space_id == space.id, TripMember.user_id == user_id
        )
    )


def require_space(
    session: Session, space_id: uuid.UUID, user_id: uuid.UUID, need: Role | None = None
) -> TravelSpace:
    space = session.get(TravelSpace, space_id)
    role = role_in_space(session, space, user_id) if space is not None else None
    if role is None:
        raise AppError(404, "Not found.")
    needed = need or default_need()
    if RANK[role] < RANK[needed]:
        raise AppError(403, "Your role on this trip does not allow that.")
    return space


def member_space_ids(session: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Every trip the person owns or has joined."""
    owned_ids = session.scalars(select(TravelSpace.id).where(TravelSpace.user_id == user_id)).all()
    joined = session.scalars(select(TripMember.travel_space_id).where(TripMember.user_id == user_id)).all()
    return list({*owned_ids, *joined})
