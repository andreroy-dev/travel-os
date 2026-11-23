from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import create_access_token
from app.models.entities import User, UserPreference
from app.schemas import DevLoginIn, PreferenceIn, PreferenceOut, TokenOut, UserOut, UserUpdate
from app.services.account_data import delete_account, export_account
from app.services.validation import ensure_currency, ensure_timezone

router = APIRouter()


@router.post("/auth/dev-login", response_model=TokenOut)
def dev_login(payload: DevLoginIn, session: DbSession) -> TokenOut:
    settings = get_settings()
    if settings.environment != "development" or not settings.dev_login_enabled:
        raise AppError(404, "Not found.")
    email = payload.email.strip().lower()
    user = session.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, display_name=payload.display_name.strip())
        session.add(user)
        session.flush()
        session.add(UserPreference(user_id=user.id))
    else:
        user.display_name = payload.display_name.strip()
    session.commit()
    return TokenOut(access_token=create_access_token(user.id))


@router.get("/users/me", response_model=UserOut)
def read_me(user: CurrentUser) -> User:
    return user


@router.patch("/users/me", response_model=UserOut)
def update_me(payload: UserUpdate, user: CurrentUser, session: DbSession) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    session.commit()
    return user


@router.get("/users/me/export")
def export_me(user: CurrentUser, session: DbSession) -> dict:
    return export_account(session, user)


@router.delete("/users/me", status_code=204)
def delete_me(user: CurrentUser, session: DbSession) -> None:
    delete_account(session, user)


@router.get("/preferences", response_model=PreferenceOut)
def read_preferences(user: CurrentUser, session: DbSession) -> UserPreference:
    preference = session.get(UserPreference, user.id)
    if preference is None:
        preference = UserPreference(user_id=user.id)
        session.add(preference)
        session.commit()
    return preference


@router.put("/preferences", response_model=PreferenceOut)
def update_preferences(payload: PreferenceIn, user: CurrentUser, session: DbSession) -> UserPreference:
    ensure_currency(payload.home_currency)
    ensure_timezone(payload.timezone)
    payload.home_currency = payload.home_currency.upper()
    preference = session.get(UserPreference, user.id)
    if preference is None:
        preference = UserPreference(user_id=user.id)
        session.add(preference)
    for field, value in payload.model_dump().items():
        setattr(preference, field, value)
    session.commit()
    return preference


@router.get("/auth/config")
def auth_config() -> dict:
    """Tells the app which sign-in methods this server accepts."""
    settings = get_settings()
    return {
        "dev_login": settings.environment == "development" and settings.dev_login_enabled,
        "supabase": bool(settings.supabase_url or settings.supabase_jwt_secret),
    }


@router.get("/health")
def health(session: DbSession) -> dict:
    session.execute(select(1))
    return {"status": "ok", "service": "travel-os"}
