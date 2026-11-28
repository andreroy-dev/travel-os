import uuid
from typing import TypeVar

from sqlalchemy.orm import Session

from app.api.permissions import RANK, Role, default_need, require_space
from app.core.errors import AppError
from app.models import TravelSpace

T = TypeVar("T")


def owned(
    session: Session,
    model: type[T],
    record_id: uuid.UUID,
    user_id: uuid.UUID,
    need: Role | None = None,
) -> T:
    """Fetch a record the person may use.

    A trip is checked by membership and role. A record filed to a trip follows
    that trip's rules, so every member can use it. A record with no trip stays
    private to the person who made it.
    """
    record = session.get(model, record_id)
    if record is None:
        raise AppError(404, "Not found.")
    if isinstance(record, TravelSpace):
        require_space(session, record.id, user_id, need)
        return record
    space_id = getattr(record, "travel_space_id", None)
    if space_id is not None:
        require_space(session, space_id, user_id, need)
        return record
    if getattr(record, "user_id") != user_id:
        raise AppError(404, "Not found.")
    return record


__all__ = ["owned", "Role", "RANK", "default_need"]
