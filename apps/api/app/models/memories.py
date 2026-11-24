"""Photos and journal notes the traveller chose to keep. No image analysis."""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MemoryPhoto(Base):
    __tablename__ = "memory_photos"
    __table_args__ = (UniqueConstraint("user_id", "asset_key", name="uq_memory_photo_asset"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    asset_key: Mapped[str] = mapped_column(String(240))
    filename: Mapped[str] = mapped_column(String(240))
    taken_on: Mapped[date | None] = mapped_column(Date)
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    place_label: Mapped[str | None] = mapped_column(String(200))
    caption: Mapped[str | None] = mapped_column(Text)
    album: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JournalNote(Base):
    __tablename__ = "journal_notes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    travel_space_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("travel_spaces.id", ondelete="CASCADE"), index=True
    )
    on_date: Mapped[date] = mapped_column(Date)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
