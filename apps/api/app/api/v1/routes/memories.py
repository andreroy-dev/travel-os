from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.memory_schemas import JournalIn, JournalOut, PhotoIn, PhotoOut
from app.models.entities import TravelSpace
from app.models.memories import JournalNote, MemoryPhoto

router = APIRouter()

MAP_NOTE = "A map provider is not connected, so photos with coordinates are listed rather than drawn on a map."


@router.get("/memories")
def list_memories(user: CurrentUser, session: DbSession, travel_space_id: UUID) -> dict:
    owned(session, TravelSpace, travel_space_id, user.id)
    photos = list(
        session.scalars(
            select(MemoryPhoto)
            .where(MemoryPhoto.travel_space_id == travel_space_id)
            .order_by(MemoryPhoto.taken_on, MemoryPhoto.created_at)
        ).all()
    )
    notes = list(
        session.scalars(
            select(JournalNote)
            .where(JournalNote.travel_space_id == travel_space_id)
            .order_by(JournalNote.on_date)
        ).all()
    )
    return {
        "photos": [PhotoOut.model_validate(photo, from_attributes=True).model_dump(mode="json") for photo in photos],
        "notes": [JournalOut.model_validate(note, from_attributes=True).model_dump(mode="json") for note in notes],
        "located": [
            PhotoOut.model_validate(photo, from_attributes=True).model_dump(mode="json")
            for photo in photos
            if photo.latitude is not None and photo.longitude is not None
        ],
        "map_note": MAP_NOTE,
    }


@router.post("/memories/photos", response_model=PhotoOut, status_code=201)
def create_photo(payload: PhotoIn, user: CurrentUser, session: DbSession) -> MemoryPhoto:
    owned(session, TravelSpace, payload.travel_space_id, user.id)
    if payload.latitude is not None and not -90 <= payload.latitude <= 90:
        raise AppError(422, "That latitude is not usable.")
    if payload.longitude is not None and not -180 <= payload.longitude <= 180:
        raise AppError(422, "That longitude is not usable.")
    photo = MemoryPhoto(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        asset_key=payload.asset_key.strip(),
        filename=payload.filename.strip(),
        taken_on=payload.taken_on,
        latitude=payload.latitude,
        longitude=payload.longitude,
        place_label=payload.place_label.strip() if payload.place_label else None,
        caption=payload.caption.strip() if payload.caption else None,
        album=payload.album.strip() if payload.album else None,
    )
    session.add(photo)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise AppError(409, "That photo is already saved on this account.") from None
    session.refresh(photo)
    return photo


@router.delete("/memories/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, MemoryPhoto, photo_id, user.id))
    session.commit()


@router.post("/memories/notes", response_model=JournalOut, status_code=201)
def create_note(payload: JournalIn, user: CurrentUser, session: DbSession) -> JournalNote:
    owned(session, TravelSpace, payload.travel_space_id, user.id)
    note = JournalNote(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        on_date=payload.on_date,
        body=payload.body.strip(),
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@router.delete("/memories/notes/{note_id}", status_code=204)
def delete_note(note_id: UUID, user: CurrentUser, session: DbSession) -> None:
    session.delete(owned(session, JournalNote, note_id, user.id))
    session.commit()
