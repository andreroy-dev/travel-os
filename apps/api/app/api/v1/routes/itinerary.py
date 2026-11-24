from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.models.entities import ItineraryItem, ItineraryKind, ItineraryStatus, TravelSpace
from app.schemas import ItineraryOut, ItineraryViewOut, PlanIn

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


@router.post("/itinerary/plans", response_model=ItineraryOut, status_code=201)
def create_plan(payload: PlanIn, user: CurrentUser, session: DbSession) -> ItineraryItem:
    """Save a planned activity the traveller named. This does not create a booking."""
    space = owned(session, TravelSpace, payload.travel_space_id, user.id)
    if space.start_date and payload.starts_on < space.start_date:
        raise AppError(422, "That date is before this trip.")
    if space.end_date and payload.starts_on > space.end_date:
        raise AppError(422, "That date is after this trip.")
    item = ItineraryItem(
        user_id=user.id,
        travel_space_id=space.id,
        kind=ItineraryKind.activity,
        status=ItineraryStatus.planned,
        title=payload.title.strip(),
        starts_on=payload.starts_on,
        ends_on=payload.starts_on,
        location_label=payload.location_label,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/itinerary/plans/{item_id}", status_code=204)
def delete_plan(item_id: UUID, user: CurrentUser, session: DbSession) -> None:
    """Remove a plan the traveller added. Items that come from bookings, stays or journeys are removed there."""
    item = owned(session, ItineraryItem, item_id, user.id)
    if item.booking_id or item.stay_id or item.journey_id:
        raise AppError(409, "This comes from a booking or stay. Change it there instead.")
    session.delete(item)
    session.commit()
