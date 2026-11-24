import hashlib
import hmac
import html
import json
from datetime import UTC, datetime
from io import BytesIO
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import HTMLResponse
from pypdf import PdfReader
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Today
from app.api.ownership import owned
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import create_access_token, decode_access_token, read_return_to
from app.models.entities import (
    Booking,
    BookingSourceKind,
    IntegrationStatus,
    Journey,
    Notification,
    Stay,
    TravelSpace,
    TravelSpaceStatus,
    User,
)
from app.models.living import VisaLog, VisaSpan
from app.models.wallet import TravelDocument
from app.schemas import (
    ConnectIn,
    ConnectOut,
    EmailIn,
    GmailAccountOut,
    InboundMailIn,
    IngestOut,
    IntegrationOut,
    NotificationOut,
    ReminderOut,
)
from app.services.documents import document_reminders
from app.services.gmail import (
    authorization_url,
    connect_from_code,
    disconnect,
    gmail_accounts,
    sync_gmail,
    trip_search_query,
)
from app.services.ingest import InboundMessage, ingest_message, record_for_review
from app.services.reminders import upcoming_reminders
from app.services.stay_coverage import compute_coverage
from app.services.visa_days import count_stay, stay_reminders

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


@router.post("/emails/inbound", response_model=IngestOut)
def inbound_email(
    payload: InboundMailIn,
    session: DbSession,
    x_inbound_secret: str | None = Header(default=None),
) -> IngestOut:
    """Mail provider webhook. The address trips+<user id>@<inbound domain> identifies the account.

    Only the mail provider knows the shared secret, so nobody can post bookings into an account directly.
    """
    settings = get_settings()
    if not (settings.inbound_email_domain and settings.inbound_email_secret):
        raise AppError(404, "Forwarding import is not set up.")
    if not hmac.compare_digest((x_inbound_secret or "").encode(), settings.inbound_email_secret.encode()):
        raise AppError(401, "Not allowed.")
    if payload.to.split("@", 1)[-1].lower() != settings.inbound_email_domain.lower():
        raise AppError(404, "That forwarding address is not registered.")
    local = payload.to.split("@", 1)[0].lower()
    token = local.removeprefix("trips+")
    try:
        user_id = UUID(hex=token)
    except ValueError as exc:
        raise AppError(404, "That forwarding address is not registered.") from exc
    user = session.get(User, user_id)
    if user is None or not local.startswith("trips+"):
        raise AppError(404, "That forwarding address is not registered.")
    result = ingest_message(
        session,
        user.id,
        InboundMessage(
            external_id=f"forward:{hashlib.sha256((payload.subject + payload.text).encode()).hexdigest()[:24]}",
            subject=payload.subject or "Forwarded confirmation",
            body=payload.text,
            source=BookingSourceKind.forward,
        ),
    )
    session.commit()
    return _out(result)


@router.post("/documents", response_model=IngestOut)
async def import_document(
    user: CurrentUser,
    session: DbSession,
    file: UploadFile = File(...),
    travel_space_id: UUID | None = Form(None),
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
    window = None
    if travel_space_id is not None:
        space = owned(session, TravelSpace, travel_space_id, user.id)
        if space.start_date and space.end_date:
            window = (space.start_date, space.end_date)
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
            travel_space_id=travel_space_id,
            date_window=window,
        ),
    )
    session.commit()
    return _out(result)


@router.get("/integrations/gmail", response_model=IntegrationOut)
def gmail_status(user: CurrentUser, session: DbSession) -> IntegrationOut:
    """Every Gmail inbox this person has linked; `status` is connected when any of them is."""
    accounts = gmail_accounts(session, user.id)
    connected = [row for row in accounts if row.status == IntegrationStatus.connected]
    synced = [row.last_synced_at for row in accounts if row.last_synced_at is not None]
    status = "connected" if connected else ("error" if accounts else "disconnected")
    return IntegrationOut(
        provider="gmail",
        status=status,
        scopes=sorted({scope for row in connected for scope in (row.scopes or [])}),
        last_synced_at=max(synced) if synced else None,
        accounts=[
            GmailAccountOut(
                id=row.id,
                email=row.external_account,
                status=row.status.value,
                last_synced_at=row.last_synced_at,
            )
            for row in accounts
        ],
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
    """Disconnect every linked Gmail account."""
    disconnect(session, user)


@router.delete("/integrations/gmail/{account_id}", status_code=204)
def gmail_disconnect_account(account_id: UUID, user: CurrentUser, session: DbSession) -> None:
    """Disconnect one Gmail account; bookings already read from it stay."""
    disconnect(session, user, account_id)


@router.post("/integrations/gmail/sync", response_model=list[IngestOut])
def gmail_sync(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID | None = None,
    account_id: UUID | None = None,
) -> list[IngestOut]:
    query = None
    date_window = None
    if travel_space_id is not None:
        space = owned(session, TravelSpace, travel_space_id, user.id)
        if space.start_date is None or space.end_date is None:
            raise AppError(409, "Set the start and end dates on this Travel Space before syncing.")
        query = trip_search_query(space.start_date, space.end_date)
        date_window = (space.start_date, space.end_date)
    results = sync_gmail(session, user, travel_space_id, query, date_window, account_id)
    return [_out(result) for result in results]


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


@router.get("/reminders", response_model=list[ReminderOut])
def list_reminders(user: CurrentUser, session: DbSession, today: Today) -> list[dict]:
    bookings = list(session.scalars(select(Booking).where(Booking.user_id == user.id)).all())
    spaces = list(
        session.scalars(
            select(TravelSpace).where(
                TravelSpace.user_id == user.id,
                TravelSpace.status != TravelSpaceStatus.archived,
            )
        ).all()
    )
    gaps = []
    for space in spaces:
        if space.start_date is None or space.end_date is None:
            continue
        space_bookings = [booking for booking in bookings if booking.travel_space_id == space.id]
        stays = list(session.scalars(select(Stay).where(Stay.travel_space_id == space.id)).all())
        journeys = list(session.scalars(select(Journey).where(Journey.travel_space_id == space.id)).all())
        gaps.extend(compute_coverage(space.start_date, space.end_date, space_bookings, stays, journeys).gaps)
    notes = upcoming_reminders(bookings, gaps, today)
    logs = list(session.scalars(select(VisaLog).where(VisaLog.user_id == user.id)).all())
    spans = list(session.scalars(select(VisaSpan).where(VisaSpan.user_id == user.id)).all())
    grouped: dict = {}
    for span in spans:
        grouped.setdefault(span.visa_log_id, []).append(span)
    notes.extend(
        stay_reminders(
            [
                {
                    "label": log.label,
                    "count": count_stay(
                        log.rule.value,
                        [(span.entered_on, span.exited_on) for span in grouped.get(log.id, [])],
                        today,
                        log.allowed_days,
                    ),
                }
                for log in logs
            ],
            today,
        )
    )
    documents = list(session.scalars(select(TravelDocument).where(TravelDocument.user_id == user.id)).all())
    notes.extend(document_reminders(documents, today))
    existing = {
        (note.kind, note.body)
        for note in session.scalars(
            select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
        ).all()
    }
    created = False
    for note in notes:
        key = (note["kind"], note["body"])
        if key in existing:
            continue
        session.add(Notification(user_id=user.id, kind=note["kind"], title=note["title"], body=note["body"]))
        created = True
    if created:
        session.commit()
    return notes


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
