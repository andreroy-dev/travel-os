from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.entities import (
    Booking,
    Conversation,
    ItineraryItem,
    Journey,
    SavedPlace,
    Stay,
    TravelSpace,
    TravelSpaceStatus,
)


def merge_spaces(session: Session, source: TravelSpace, target: TravelSpace) -> None:
    """Move every record from `source` into `target`, widen the dates, archive `source`.

    Nothing is deleted except a saved place that already exists in the target.
    The archived source stays restorable (empty) from the Archived list.
    """
    for model in (Booking, Stay, Journey, ItineraryItem, Conversation):
        session.execute(
            update(model)
            .where(model.user_id == source.user_id, model.travel_space_id == source.id)
            .values(travel_space_id=target.id)
        )

    existing = set(
        session.scalars(
            select(SavedPlace.location_id).where(
                SavedPlace.user_id == target.user_id, SavedPlace.travel_space_id == target.id
            )
        ).all()
    )
    for place in session.scalars(
        select(SavedPlace).where(
            SavedPlace.user_id == source.user_id, SavedPlace.travel_space_id == source.id
        )
    ).all():
        if place.location_id in existing:
            session.delete(place)
        else:
            place.travel_space_id = target.id

    starts = [d for d in (source.start_date, target.start_date) if d is not None]
    ends = [d for d in (source.end_date, target.end_date) if d is not None]
    target.start_date = min(starts) if starts else None
    target.end_date = max(ends) if ends else None
    if target.destination_id is None:
        target.destination_id = source.destination_id
    source.status = TravelSpaceStatus.archived
