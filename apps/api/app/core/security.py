import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings
from app.core.errors import AppError


@dataclass(frozen=True)
class TokenIdentity:
    user_id: uuid.UUID | None
    supabase_user_id: str | None
    email: str | None = None
    display_name: str | None = None
    email_verified: bool = False


def create_access_token(user_id: uuid.UUID, purpose: str = "access", return_to: str | None = None) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    ttl = timedelta(minutes=15) if purpose != "access" else timedelta(days=settings.jwt_ttl_days)
    payload = {
        "sub": str(user_id),
        "purpose": purpose,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    if return_to:
        payload["return_to"] = return_to
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def read_return_to(token: str) -> str | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    value = payload.get("return_to")
    return value if isinstance(value, str) else None


def decode_access_token(token: str, purpose: str = "access") -> TokenIdentity:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        if purpose != "access":
            raise AppError(401, "Sign in again.") from exc
        return _decode_supabase(token)
    if payload.get("purpose", "access") != purpose:
        raise AppError(401, "Sign in again.")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except (KeyError, ValueError) as exc:
        raise AppError(401, "Sign in again.") from exc
    return TokenIdentity(user_id=user_id, supabase_user_id=None)


_jwks_client: "jwt.PyJWKClient | None" = None


def _supabase_payload(token: str) -> dict | None:
    """Verify a Supabase access token.

    Newer Supabase projects sign with asymmetric keys published at
    <SUPABASE_URL>/auth/v1/.well-known/jwks.json; older ones use the shared
    HS256 JWT secret. Both are accepted; audience must be "authenticated".
    """
    global _jwks_client
    settings = get_settings()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    try:
        if header.get("alg") == "HS256":
            if not settings.supabase_jwt_secret:
                return None
            return jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated"
            )
        if not settings.supabase_url:
            return None
        if _jwks_client is None:
            _jwks_client = jwt.PyJWKClient(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True
            )
        key = _jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token, key.key, algorithms=["ES256", "RS256"], audience="authenticated"
        )
    except jwt.PyJWTError:
        return None


def _decode_supabase(token: str) -> TokenIdentity:
    payload = _supabase_payload(token)
    if payload is None or "sub" not in payload:
        raise AppError(401, "Sign in again.")
    metadata = payload.get("user_metadata") or {}
    name = metadata.get("full_name") or metadata.get("name")
    return TokenIdentity(
        user_id=None,
        supabase_user_id=str(payload["sub"]),
        email=payload.get("email"),
        display_name=name,
        # Email OTP, Apple and Google all confirm the address before issuing a session.
        email_verified=bool(payload.get("email")) and metadata.get("email_verified", True) is not False,
    )


def encrypt_secret(value: str) -> str:
    key = get_settings().token_encryption_key
    if not key:
        raise AppError(409, "Set TOKEN_ENCRYPTION_KEY before storing OAuth credentials.")
    try:
        return Fernet(key.encode()).encrypt(value.encode()).decode()
    except (ValueError, InvalidToken) as exc:
        raise AppError(500, "TOKEN_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def decrypt_secret(value: str) -> str:
    key = get_settings().token_encryption_key
    if not key:
        raise AppError(409, "Set TOKEN_ENCRYPTION_KEY before reading OAuth credentials.")
    try:
        return Fernet(key.encode()).decrypt(value.encode()).decode()
    except (ValueError, InvalidToken) as exc:
        raise AppError(500, "Stored credential could not be decrypted.") from exc
