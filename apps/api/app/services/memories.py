"""Saved photo captions and journal notes. The image file stays on the phone."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.memories import JournalNote, MemoryPhoto


def memory_context(session: Session, user_id, space_id) -> dict:
    if space_id is None:
        return {"memory_photos": [], "journal_notes": []}
    photos = session.scalars(
        select(MemoryPhoto).where(MemoryPhoto.user_id == user_id, MemoryPhoto.travel_space_id == space_id)
    ).all()
    notes = session.scalars(
        select(JournalNote).where(JournalNote.user_id == user_id, JournalNote.travel_space_id == space_id)
    ).all()
    return {
        "memory_photos": [
            {
                "filename": photo.filename,
                "taken_on": photo.taken_on.isoformat() if photo.taken_on else None,
                "caption": photo.caption,
                "place_label": photo.place_label,
                "album": photo.album,
            }
            for photo in photos
        ],
        "journal_notes": [{"on_date": note.on_date.isoformat(), "body": note.body} for note in notes],
    }
