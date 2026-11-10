import uuid
from typing import TypeVar

from sqlalchemy.orm import Session

from app.core.errors import AppError

T = TypeVar("T")


def owned(session: Session, model: type[T], record_id: uuid.UUID, user_id: uuid.UUID) -> T:
    record = session.get(model, record_id)
    if record is None or getattr(record, "user_id") != user_id:
        raise AppError(404, "Not found.")
    return record
