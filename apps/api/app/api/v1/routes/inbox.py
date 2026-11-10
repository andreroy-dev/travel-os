import hashlib
import html
import json
from datetime import UTC, datetime
from io import BytesIO
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import HTMLResponse
from pypdf import PdfReader
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.core.security import create_access_token, decode_access_token, read_return_to
from app.models.entities import (
    BookingSourceKind,
    Integration,
    IntegrationProvider,
    Notification,
    TravelSpace,
    User,
)
from app.schemas import ConnectIn, ConnectOut, EmailIn, IngestOut, IntegrationOut, NotificationOut
from app.services.gmail import authorization_url, connect_from_code, disconnect, sync_gmail, trip_search_query
from app.services.ingest import InboundMessage, ingest_message, record_for_review

router = APIRouter()


def _out(result) -> IngestOut:
    return IngestOut(
        status=result.status,
        classification=result.classification.value,
        booking_id=result.booking_id,
        detail=result.detail,
    )


@router.post("/emails/import", response_model=IngestOut)
def import_email(payload: EmailIn, user: CurrentUser, session: DbSession) -> IngestOut:
    result = ingest_message(
        session,
        user.id,
        InboundMessage(
            external_id=payload.external_id,
            subject=payload.subject,
            body=payload.body,
            source=BookingSourceKind.forward,
            received_at=payload.received_at,
        ),
    )
    session.commit()
    return _out(result)


@router.post("/documents", response_model=IngestOut)
async def import_document(
    user: CurrentUser,
    session: DbSession,
    file: UploadFile = File(...),
) -> IngestOut:
    raw = await file.read()
    name = file.filename or "upload"
    external_id = f"file:{hashlib.sha256(raw).hexdigest()[:20]}"
    if not name.lower().endswith((".pdf", ".txt", ".eml")):
        result = record_for_review(
            session,
            user.id,
            InboundMessage(
                external_id=external_id,
                subject=name,
                body="",
                source=BookingSourceKind.screenshot,
            ),
            "This image could not be read. Add the booking manually or upload a PDF.",
        )
        session.commit()
        return _out(result)
    if name.lower().endswith(".pdf"):
        try:
            text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(raw)).pages)
        except Exception as exc:
            raise AppError(422, "Could not read that PDF.") from exc
    else:
        text = raw.decode("utf-8", errors="replace")
    result = ingest_message(
        session,
        user.id,
        InboundMessage(
            external_id=external_id,
            subject=name,
            body=text,
            source=BookingSourceKind.upload,
        ),
    )
    session.commit()
    return _out(result)


@router.get("/integrations/gmail", response_model=IntegrationOut)
def gmail_status(user: CurrentUser, session: DbSession) -> IntegrationOut:
    integration = session.scalar(
        select(Integration).where(
            Integration.user_id == user.id,
            Integration.provider == IntegrationProvider.gmail,
        )
    )
    if integration is None:
        return IntegrationOut(provider="gmail", status="disconnected", scopes=[], last_synced_at=None)
    return IntegrationOut(
        provider="gmail",
        status=integration.status.value,
        scopes=list(integration.scopes or []),
        last_synced_at=integration.last_synced_at,
    )


@router.post("/integrations/gmail/connect", response_model=ConnectOut)
def gmail_connect(user: CurrentUser, payload: ConnectIn) -> ConnectOut:
    state = create_access_token(user.id, purpose="gmail_oauth", return_to=_app_return_url(payload.return_to))
    return ConnectOut(authorization_url=authorization_url(state))


@router.get("/integrations/gmail/callback", response_class=HTMLResponse)
def gmail_callback(
    state: str,
    session: DbSession,
    code: str | None = None,
    error: str | None = None,
) -> HTMLResponse:
    if error or not code:
        return _gmail_page("Gmail was not connected", "Google did not grant access. Close this window and try Connect again.")
    try:
        identity = decode_access_token(state, purpose="gmail_oauth")
        user = session.get(User, identity.user_id) if identity.user_id else None
        if user is None:
            return _gmail_page("Gmail was not connected", "This sign-in expired. Close this window and try Connect again.")
        connect_from_code(session, user, code)
    except AppError as exc:
        return _gmail_page("Gmail was not connected", exc.detail)
    return_to = _app_return_url(read_return_to(state))
    if return_to:
        return _gmail_page("Gmail is connected", "Returning to Travel OS.", return_to)
    return _gmail_page(
        "Gmail is connected",
        "Close this window and return to Travel OS. Open a Travel Space, then sync bookings and itinerary.",
    )


@router.delete("/integrations/gmail", status_code=204)
def gmail_disconnect(user: CurrentUser, session: DbSession) -> None:
    disconnect(session, user)


@router.post("/integrations/gmail/sync", response_model=list[IngestOut])
def gmail_sync(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID | None = None,
) -> list[IngestOut]:
    query = None
    date_window = None
    if travel_space_id is not None:
        space = owned(session, TravelSpace, travel_space_id, user.id)
        if space.start_date is None or space.end_date is None:
            raise AppError(409, "Set the start and end dates on this Travel Space before syncing.")
        query = trip_search_query(space.start_date, space.end_date)
        date_window = (space.start_date, space.end_date)
    return [_out(result) for result in sync_gmail(session, user, travel_space_id, query, date_window)]


def _app_return_url(value: str | None) -> str | None:
    if not value or len(value) > 500:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"exp", "exps", "travelos"} or parsed.username or parsed.password:
        return None
    return value


def _gmail_page(title: str, body: str, return_to: str | None = None) -> HTMLResponse:
    safe_title = html.escape(title)
    safe_body = html.escape(body)
    jump = ""
    if return_to:
        href = html.escape(return_to, quote=True)
        target = json.dumps(return_to)
        jump = f'<p><a href="{href}">Return to Travel OS</a></p><script>window.location.replace({target});</script>'
    page = f"""<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f6f1;color:#14211c;">
  <main style="padding:48px 24px;">
    <h1 style="font-size:28px;margin:0 0 12px;">{safe_title}</h1>
    <p style="font-size:18px;line-height:1.4;margin:0;">{safe_body}</p>
    {jump}
  </main>
</body>
</html>"""
    return HTMLResponse(page)


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(user: CurrentUser, session: DbSession) -> list[Notification]:
    return list(
        session.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc())
        ).all()
    )


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: UUID, user: CurrentUser, session: DbSession) -> Notification:
    note = owned(session, Notification, notification_id, user.id)
    note.read_at = datetime.now(UTC)
    session.commit()
    session.refresh(note)
    return note
