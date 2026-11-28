from datetime import date
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.services import document_files
from app.models.entities import TravelSpace
from app.models.wallet import EmergencyContact, TravelDocument

router = APIRouter()

KINDS = {
    "passport",
    "visa",
    "boarding_pass",
    "ticket",
    "insurance",
    "driving_licence",
    "international_driving_permit",
    "permit",
    "identification",
    "vaccination",
    "other",
}
KIND_TITLES = {
    "passport": "Passport",
    "visa": "Visa",
    "boarding_pass": "Boarding pass",
    "ticket": "Ticket",
    "insurance": "Travel insurance",
    "driving_licence": "Driving licence",
    "international_driving_permit": "International Driving Permit",
    "permit": "Permit",
    "identification": "ID card",
    "vaccination": "Vaccination record",
    "other": "Document",
}


class DocumentIn(BaseModel):
    travel_space_id: UUID | None = None
    kind: str
    title: str = Field(min_length=1, max_length=200)
    reference: str | None = Field(default=None, max_length=80)
    expires_on: date | None = None
    notes: str | None = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    travel_space_id: UUID | None
    kind: str
    title: str
    reference: str | None
    expires_on: date | None
    notes: str | None
    file_name: str | None = None
    content_type: str | None = None
    file_size: int | None = None
    has_file: bool = False


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=3, max_length=40)
    relationship: str | None = Field(default=None, max_length=80)


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    phone: str
    relationship: str | None


def _doc_out(row: TravelDocument) -> DocumentOut:
    out = DocumentOut.model_validate(row, from_attributes=True)
    out.has_file = bool(row.file_key)
    return out


@router.get("/wallet/documents", response_model=list[DocumentOut])
def list_documents(user: CurrentUser, session: DbSession) -> list[DocumentOut]:
    rows = session.scalars(
        select(TravelDocument).where(TravelDocument.user_id == user.id).order_by(TravelDocument.created_at.desc())
    ).all()
    return [_doc_out(row) for row in rows]


@router.post("/wallet/documents/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    user: CurrentUser,
    session: DbSession,
    file: UploadFile = File(...),
    kind: str = Form("other"),
    title: str | None = Form(None),
    expires_on: date | None = Form(None),
    travel_space_id: UUID | None = Form(None),
) -> DocumentOut:
    """Upload a scan or PDF. Only the file is required; a title is filled in from the type."""
    if kind not in KINDS:
        raise AppError(422, "Choose a document type from the list.")
    if travel_space_id is not None:
        owned(session, TravelSpace, travel_space_id, user.id)
    raw = await file.read()
    key, content_type, size = document_files.save(user.id, raw, file.content_type, file.filename or "document")
    row = TravelDocument(
        user_id=user.id,
        travel_space_id=travel_space_id,
        kind=kind,
        title=(title or "").strip() or KIND_TITLES[kind],
        expires_on=expires_on,
        file_key=key,
        file_name=(file.filename or "document")[:240],
        content_type=content_type,
        file_size=size,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _doc_out(row)


@router.get("/wallet/documents/{document_id}/file")
def document_file(document_id: UUID, user: CurrentUser, session: DbSession) -> Response:
    row = owned(session, TravelDocument, document_id, user.id)
    if not row.file_key:
        raise AppError(404, "This document has no file attached.")
    return Response(
        document_files.read(row.file_key),
        media_type=row.content_type or "application/octet-stream",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/wallet/documents", response_model=DocumentOut, status_code=201)
def create_document(payload: DocumentIn, user: CurrentUser, session: DbSession) -> DocumentOut:
    if payload.kind not in KINDS:
        raise AppError(422, "Choose a document type from the list.")
    if payload.travel_space_id is not None:
        owned(session, TravelSpace, payload.travel_space_id, user.id)
    row = TravelDocument(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        kind=payload.kind,
        title=payload.title.strip(),
        reference=payload.reference.strip() if payload.reference else None,
        expires_on=payload.expires_on,
        notes=payload.notes,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _doc_out(row)


@router.delete("/wallet/documents/{document_id}", status_code=204)
def delete_document(document_id: UUID, user: CurrentUser, session: DbSession) -> None:
    row = owned(session, TravelDocument, document_id, user.id)
    key = row.file_key
    session.delete(row)
    session.commit()
    document_files.delete(key)


@router.get("/wallet/contacts", response_model=list[ContactOut])
def list_contacts(user: CurrentUser, session: DbSession) -> list[EmergencyContact]:
    return list(session.scalars(select(EmergencyContact).where(EmergencyContact.user_id == user.id)).all())


@router.post("/wallet/contacts", response_model=ContactOut, status_code=201)
def create_contact(payload: ContactIn, user: CurrentUser, session: DbSession) -> EmergencyContact:
    row = EmergencyContact(
        user_id=user.id,
        name=payload.name.strip(),
        phone=payload.phone.strip(),
        relationship=payload.relationship.strip() if payload.relationship else None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/wallet/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, EmergencyContact, contact_id, user.id))
    session.commit()
