from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PhotoIn(BaseModel):
    travel_space_id: UUID
    asset_key: str = Field(min_length=1, max_length=240)
    filename: str = Field(min_length=1, max_length=240)
    taken_on: date | None = None
    latitude: float | None = None
    longitude: float | None = None
    place_label: str | None = Field(default=None, max_length=200)
    caption: str | None = None
    album: str | None = Field(default=None, max_length=120)


class JournalIn(BaseModel):
    travel_space_id: UUID
    on_date: date
    body: str = Field(min_length=1, max_length=4000)


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    asset_key: str
    filename: str
    taken_on: date | None
    latitude: float | None
    longitude: float | None
    place_label: str | None
    caption: str | None
    album: str | None


class JournalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    on_date: date
    body: str
