import base64
import html
import json
import re
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import decrypt_secret, encrypt_secret
from app.models.entities import (
    BookingSourceKind,
    Integration,
    IntegrationProvider,
    IntegrationStatus,
    User,
)
from app.services.ingest import InboundMessage, IngestResult, ingest_message

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_LIST_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
_QUERY = (
    "newer_than:120d (subject:confirmation OR subject:booking OR subject:reservation "
    "OR subject:itinerary OR subject:e-ticket)"
)


def authorization_url(state: str) -> str:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise AppError(
            409,
            "Gmail is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )
    if not settings.token_encryption_key:
        raise AppError(409, "Set TOKEN_ENCRYPTION_KEY before connecting Gmail.")
    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": GMAIL_SCOPE,
            "access_type": "offline",
            # Always show Google's account chooser so a second inbox can be added.
            "prompt": "consent select_account",
            "include_granted_scopes": "false",
            "state": state,
        }
    )
    return f"{_AUTH_URL}?{query}"


def connect_from_code(session: Session, user: User, code: str) -> Integration:
    """Finish Google's consent screen. Each Gmail address becomes its own connected account."""
    settings = get_settings()
    try:
        response = httpx.post(
            _TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=20,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise AppError(502, "Google did not accept the Gmail authorization.") from exc
    payload = response.json()
    refresh = payload.get("refresh_token")
    if not refresh:
        raise AppError(502, "Google did not return a refresh token. Try connecting again.")
    email = _account_email(payload.get("access_token") or _refresh_access_token(refresh))
    if not email:
        raise AppError(502, "Google did not say which Gmail address was connected. Try again.")
    _fill_missing_addresses(session, user.id)
    integration = _integration_for(session, user.id, email)
    integration.status = IntegrationStatus.connected
    integration.scopes = [GMAIL_SCOPE]
    integration.token_ciphertext = encrypt_secret(json.dumps({"refresh_token": refresh}))
    integration.external_account = email
    session.commit()
    return integration


def gmail_accounts(session: Session, user_id) -> list[Integration]:
    """Connected Gmail inboxes (and ones whose access stopped working), oldest first."""
    if _fill_missing_addresses(session, user_id):
        session.commit()
    return [row for row in _rows(session, user_id) if row.status in _LISTED]


def revoke_google_access(ciphertext: str | None) -> None:
    """Best effort: tell Google to drop our refresh token. Never blocks a disconnect."""
    if not ciphertext:
        return
    try:
        refresh = json.loads(decrypt_secret(ciphertext)).get("refresh_token")
        if refresh:
            httpx.post("https://oauth2.googleapis.com/revoke", data={"token": refresh}, timeout=10)
    except Exception:  # noqa: BLE001 - revocation failure must not keep the user's data around
        pass


def disconnect(session: Session, user: User, account_id=None) -> None:
    """Disconnect one Gmail account, or every one when no account is named."""
    rows = [
        row
        for row in _rows(session, user.id)
        if row.status != IntegrationStatus.disconnected and (account_id is None or row.id == account_id)
    ]
    if account_id is not None and not rows:
        raise AppError(404, "That Gmail account is not connected.")
    for integration in rows:
        revoke_google_access(integration.token_ciphertext)
        integration.status = IntegrationStatus.disconnected
        integration.token_ciphertext = None
        integration.scopes = []
    session.commit()


def sync_gmail(
    session: Session,
    user: User,
    travel_space_id=None,
    query: str | None = None,
    date_window: tuple[date, date] | None = None,
    account_id=None,
) -> list[IngestResult]:
    """Read booking mail from every connected Gmail account (or the one named)."""
    accounts = [
        row
        for row in _rows(session, user.id)
        if row.status == IntegrationStatus.connected
        and row.token_ciphertext
        and (account_id is None or row.id == account_id)
    ]
    if not accounts:
        raise AppError(409, "Connect Gmail before syncing.")
    results: list[IngestResult] = []
    failures: list[AppError] = []
    for integration in accounts:
        try:
            results.extend(
                _sync_account(session, user, integration, travel_space_id, query, date_window)
            )
        except AppError as exc:
            failures.append(exc)
    session.commit()
    if failures and len(failures) == len(accounts):
        raise failures[0]
    return results


def _sync_account(
    session: Session,
    user: User,
    integration: Integration,
    travel_space_id,
    query: str | None,
    date_window: tuple[date, date] | None,
) -> list[IngestResult]:
    secret = json.loads(decrypt_secret(integration.token_ciphertext))
    try:
        access_token = _refresh_access_token(secret["refresh_token"])
    except _AccessRemoved as exc:
        integration.status = IntegrationStatus.error
        name = integration.external_account or "a Gmail account"
        message = f"Travel OS lost access to {name}. Reconnect it in Profile → Gmail."
        raise AppError(409, message) from exc
    if not integration.external_account:
        integration.external_account = _account_email(access_token)
    message_ids = _list_message_ids(access_token, query or _QUERY)
    parsed_messages = [(mid, _fetch_message(access_token, mid)) for mid in message_ids]
    results: list[IngestResult] = []
    for message_id, parsed in parsed_messages:
        results.append(
            ingest_message(
                session,
                user.id,
                InboundMessage(
                    external_id=f"gmail:{message_id}",
                    subject=parsed["subject"],
                    body=parsed["body"],
                    source=BookingSourceKind.gmail,
                    received_at=parsed["received_at"],
                    integration_id=integration.id,
                    travel_space_id=travel_space_id,
                    date_window=date_window,
                ),
            )
        )
    integration.last_synced_at = datetime.now(UTC)
    integration.status = IntegrationStatus.connected
    return results


_LISTED = (IntegrationStatus.connected, IntegrationStatus.error)


class _AccessRemoved(Exception):
    """Google refused the refresh token: the person revoked access or the grant expired."""


def _rows(session: Session, user_id) -> list[Integration]:
    return list(
        session.scalars(
            select(Integration)
            .where(
                Integration.user_id == user_id,
                Integration.provider == IntegrationProvider.gmail,
            )
            .order_by(Integration.created_at)
        ).all()
    )


def _integration_for(session: Session, user_id, email: str) -> Integration:
    integration = session.scalar(
        select(Integration).where(
            Integration.user_id == user_id,
            Integration.provider == IntegrationProvider.gmail,
            func.lower(Integration.external_account) == email.lower(),
        )
    )
    if integration is None:
        integration = Integration(
            user_id=user_id,
            provider=IntegrationProvider.gmail,
            status=IntegrationStatus.pending,
            scopes=[],
            external_account=email,
        )
        session.add(integration)
        session.flush()
    return integration


def _fill_missing_addresses(session: Session, user_id) -> bool:
    """Older connections did not record which inbox they belong to; ask Google once."""
    changed = False
    for row in _rows(session, user_id):
        if row.external_account or row.status not in _LISTED or not row.token_ciphertext:
            continue
        try:
            refresh = json.loads(decrypt_secret(row.token_ciphertext))["refresh_token"]
            email = _account_email(_refresh_access_token(refresh))
        except _AccessRemoved:
            row.status = IntegrationStatus.error
            changed = True
            continue
        except Exception:  # noqa: BLE001 - listing accounts must not fail because Google is slow
            continue
        if email:
            duplicate = next(
                (
                    other
                    for other in _rows(session, user_id)
                    if other.id != row.id
                    and (other.external_account or "").lower() == email.lower()
                ),
                None,
            )
            if duplicate is not None:
                row.status = IntegrationStatus.disconnected
                row.token_ciphertext = None
            else:
                row.external_account = email
            changed = True
    if changed:
        session.flush()
    return changed


def _account_email(access_token: str) -> str | None:
    try:
        response = httpx.get(
            _PROFILE_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=15
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None
    email = response.json().get("emailAddress")
    return email.strip().lower() if isinstance(email, str) and email.strip() else None


def _refresh_access_token(refresh_token: str) -> str:
    settings = get_settings()
    try:
        response = httpx.post(
            _TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=20,
        )
    except httpx.HTTPError as exc:
        raise AppError(502, "Could not refresh Gmail access.") from exc
    if response.status_code in (400, 401):
        raise _AccessRemoved()
    if response.status_code >= 300:
        raise AppError(502, "Could not refresh Gmail access.")
    token = response.json().get("access_token")
    if not token:
        raise AppError(502, "Google did not return an access token.")
    return token


_PROVIDER_DOMAINS = (
    "booking.com",
    "agoda.com",
    "cleartrip.com",
    "getyourguide.com",
    "trivago.com",
    "expedia.com",
    "hotels.com",
    "airbnb.com",
    "kayak.com",
    "skyscanner.com",
    "makemytrip.com",
    "goibibo.com",
    "ixigo.com",
    "viator.com",
    "klook.com",
    "hostelworld.com",
    "vrbo.com",
    "trip.com",
    "omio.com",
    "trainline.com",
    "flixbus.com",
    "kiwi.com",
    "opodo.com",
    "lastminute.com",
    "rentalcars.com",
    "discovercars.com",
)
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_MONTHS_SHORT = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_MONTHS_DE = (
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
)


def trip_search_query(start: date, end: date) -> str:
    """Ask Gmail for mail that mentions a date inside this trip.

    The wording can differ by provider. Gmail matches the date wherever it
    sits in the message, then Travel OS reads that smaller set.
    """
    if end < start:
        start, end = end, start
    senders = " OR ".join(f"from:{domain}" for domain in _PROVIDER_DOMAINS)
    words = (
        "confirmation OR reservation OR itinerary OR booking OR ticket "
        "OR check-in OR voucher OR pnr OR flight OR hotel OR buchung OR bestätigung"
    )
    dates = _trip_date_clause(start, end)
    return f"newer_than:730d ({senders} OR {words}) ({dates})"


def _trip_date_clause(start: date, end: date) -> str:
    """Match a date inside the trip even when the day sits between month and year.

    "January 26, 2027" does not contain the phrase "January 2027", so the month
    and year are searched as separate words, and each day is also listed.
    """
    parts: list[str] = []
    year, month = start.year, start.month
    last = end.year * 12 + end.month
    while year * 12 + month <= last:
        names = " OR ".join((_MONTHS[month - 1], _MONTHS_SHORT[month - 1], _MONTHS_DE[month - 1]))
        parts.append(f"({year} ({names}))")
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    day = start
    while day <= end and (day - start).days <= 62:
        mon = _MONTHS_SHORT[day.month - 1]
        parts.append(f'"{day.isoformat()}"')
        parts.append(f'"{day.day} {mon} {day.year}"')
        parts.append(f'"{mon} {day.day}, {day.year}"')
        parts.append(f'"{day.day:02d}.{day.month:02d}.{day.year}"')
        parts.append(f'"{day.day:02d}{mon.upper()}"')
        day += timedelta(days=1)
    return " OR ".join(parts)


def space_search_query(terms: list[str] | None = None) -> str:
    del terms
    return _QUERY


def _list_message_ids(access_token: str, query: str) -> list[str]:
    settings = get_settings()
    found: list[str] = []
    page_token: str | None = None
    while len(found) < settings.gmail_sync_limit:
        params: dict[str, str | int] = {
            "q": query,
            "maxResults": min(50, settings.gmail_sync_limit - len(found)),
        }
        if page_token:
            params["pageToken"] = page_token
        response = _gmail_get(_LIST_URL, access_token, params)
        payload = response.json()
        found.extend(item["id"] for item in payload.get("messages", []) if item.get("id"))
        page_token = payload.get("nextPageToken")
        if not page_token:
            break
    return found


def _gmail_get(url: str, access_token: str, params: dict | None = None) -> httpx.Response:
    last_error = "Could not reach Gmail."
    for attempt in range(3):
        try:
            response = httpx.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
                timeout=40,
            )
        except httpx.HTTPError:
            last_error = "Could not reach Gmail."
            continue
        if response.status_code == 429 or "quota" in _google_error(response).lower():
            raise AppError(429, "Gmail is limiting requests. Wait a minute, then tap sync once.")
        if response.status_code in {500, 502, 503}:
            last_error = "Gmail was busy."
            continue
        if response.is_error:
            detail = _google_error(response) or "Could not list Gmail messages."
            raise AppError(502, detail)
        return response
    raise AppError(502, last_error)


def _google_error(response: httpx.Response) -> str:
    try:
        message = str(response.json()["error"]["message"])
    except Exception:
        return ""
    message = " ".join(message.split())
    lowered = message.lower()
    if not message or "token" in lowered or "ya29" in lowered or "bearer" in lowered:
        return ""
    return message[:180]


def _fetch_message(access_token: str, message_id: str) -> dict:
    response = _gmail_get(
        f"{_LIST_URL}/{message_id}",
        access_token,
        {"format": "full"},
    )
    payload = response.json()
    headers = {
        header["name"].lower(): header["value"]
        for header in payload.get("payload", {}).get("headers", [])
    }
    internal = payload.get("internalDate")
    received = (
        datetime.fromtimestamp(int(internal) / 1000, tz=UTC) if internal is not None else None
    )
    return {
        "subject": headers.get("subject", ""),
        "body": _plain_text(payload.get("payload", {})),
        "received_at": received,
    }


def _plain_text(payload: dict) -> str:
    plain: list[str] = []
    html: list[str] = []

    def walk(part: dict) -> None:
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data")
        if data and mime == "text/plain":
            plain.append(_decode(data))
        elif data and mime == "text/html":
            html.append(_decode(data))
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    text = max(plain, key=len) if plain else ""
    if len(text) < 80 and html:
        text = _html_to_text(max(html, key=len))
    return text[:20000]


def _html_to_text(value: str) -> str:
    without_skips = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value)
    with_breaks = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>|<tr>|</h\d>", "\n", without_skips)
    text = re.sub(r"(?s)<[^>]+>", " ", with_breaks)
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"[ \t]+\n", "\n", re.sub(r"[ \t]{2,}", " ", text)).strip()


def _decode(data: str) -> str:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded.encode()).decode("utf-8", errors="replace")
