from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.models.entities import ItineraryItem, TravelSpace
from app.schemas import ItineraryOut, ItineraryViewOut

router = APIRouter()


@router.get("/itinerary", response_model=ItineraryViewOut)
def read_itinerary(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID | None = None,
    view: str = Query(default="chronological", pattern="^(chronological|calendar|map)$"),
) -> ItineraryViewOut:
    if travel_space_id is not None:
        owned(session, TravelSpace, travel_space_id, user.id)
    statement = select(ItineraryItem).where(ItineraryItem.user_id == user.id)
    if travel_space_id is not None:
        statement = statement.where(ItineraryItem.travel_space_id == travel_space_id)
    items = list(
        session.scalars(statement.order_by(ItineraryItem.starts_on, ItineraryItem.starts_at)).all()
    )
    serialized = [ItineraryOut.model_validate(item, from_attributes=True) for item in items]
    if view == "calendar":
        grouped: dict[str, list[ItineraryOut]] = {}
        for item in serialized:
            key = item.starts_on.isoformat() if item.starts_on else "unscheduled"
            grouped.setdefault(key, []).append(item)
        return ItineraryViewOut(view="calendar", days=grouped)
    if view == "map":
        located = [item for item in serialized if item.latitude is not None and item.longitude is not None]
        unlocated = [item for item in serialized if item.latitude is None or item.longitude is None]
        return ItineraryViewOut(view="map", located=located, unlocated=unlocated)
    return ItineraryViewOut(view="chronological", items=serialized)
