from collections.abc import Generator
from datetime import UTC, date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
        if user is None and identity.email and identity.email_verified:
            # First real sign-in for someone who used dev sign-in before: keep their data.
            existing = session.scalar(select(User).where(User.email == identity.email.lower()))
            if existing is not None and existing.supabase_user_id is None:
                existing.supabase_user_id = identity.supabase_user_id
                session.commit()
                user = existing
        if user is None:
            if not identity.email:
                raise AppError(401, "This account has no email address.")
            if session.scalar(select(User).where(User.email == identity.email.lower())) is not None:
                raise AppError(409, "This email is already linked to another sign-in method.")
            user = User(
                email=identity.email.lower(),
                display_name=identity.display_name or identity.email.split("@")[0],
                supabase_user_id=identity.supabase_user_id,
            )
            try:
                session.add(user)
                session.flush()
                session.add(UserPreference(user_id=user.id))
                session.commit()
            except IntegrityError:
                # The app fires several requests at once after sign-in; another one created
                # this user first. Use theirs.
                session.rollback()
                user = session.scalar(
                    select(User).where(User.supabase_user_id == identity.supabase_user_id)
                )
    if user is None:
        raise AppError(401, "Sign in again.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_session)]


def get_today(
    user: CurrentUser,
    session: DbSession,
    x_timezone: Annotated[str | None, Header()] = None,
) -> date:
    """Today's date where the person is: the phone's time zone, then their saved one, then UTC."""
    for name in (x_timezone, _saved_timezone(session, user)):
        if not name or len(name) > 64:
            continue
        try:
            return datetime.now(ZoneInfo(name)).date()
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return datetime.now(UTC).date()


def _saved_timezone(session: Session, user: User) -> str | None:
    preference = session.get(UserPreference, user.id)
    return preference.timezone if preference else None


Today = Annotated[date, Depends(get_today)]
