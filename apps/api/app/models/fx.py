"""One cached European Central Bank rate table. Refreshed when it is older than an hour."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FxSnapshot(Base):
    __tablename__ = "fx_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    base: Mapped[str] = mapped_column(String(3))
    rate_date: Mapped[str] = mapped_column(String(10))
    rates_json: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
