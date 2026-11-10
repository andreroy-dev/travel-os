from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.models.entities import User, UserPreference

bearer = HTTPBearer(auto_error=False)


def get_session() -> Generator[Session, None, None]:
    yield from get_db()


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    if credentials is None:
        raise AppError(401, "Sign in again.")
    identity = decode_access_token(credentials.credentials)
    if identity.user_id is not None:
        user = session.get(User, identity.user_id)
    else:
        user = session.scalar(
            select(User).where(User.supabase_user_id == identity.supabase_user_id)
        )
        if user is None:
            if not identity.email:
                raise AppError(401, "This account has no email address.")
            user = User(
                email=identity.email.lower(),
                display_name=identity.display_name or identity.email.split("@")[0],
                supabase_user_id=identity.supabase_user_id,
            )
            session.add(user)
            session.flush()
            session.add(UserPreference(user_id=user.id))
            session.commit()
    if user is None:
        raise AppError(401, "Sign in again.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_session)]
