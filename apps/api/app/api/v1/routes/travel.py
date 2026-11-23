from datetime import date
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.models.entities import (
    Booking,
    Destination,
    DestinationKind,
    Journey,
    Location,
    SavedPlace,
    Stay,
    TravelSpace,
    TravelSpaceStatus,
)
from app.schemas import (
    DestinationIn,
    DestinationOut,
    JourneyIn,
    JourneyOut,
    SavedPlaceIn,
    SavedPlaceOut,
    SavedPlaceStatusIn,
    StayIn,
    StayCoverageOut,
    StayOut,
    MergeIn,
    TravelSpaceIn,
    TravelSpacePatch,
    TravelSpaceOut,
)
from app.services.catalog import find_or_create_destination
from app.services.itinerary_sync import sync_journey_itinerary, sync_stay_itinerary
from app.services.space_merge import merge_spaces
from app.services.space_status import status_from_dates
from app.services.stay_coverage import compute_coverage
from app.services.validation import ensure_date_order

router = APIRouter()


def _space_out(space: TravelSpace) -> TravelSpaceOut:
    return TravelSpaceOut(
        id=space.id,
        title=space.title,
        kind=space.kind,
        status=space.status,
        start_date=space.start_date,
        end_date=space.end_date,
        destination_name=space.destination.name if space.destination is not None else None,
        country_code=space.destination.country_code if space.destination is not None else None,
        summary=space.summary,
    )


def _require_space(session: DbSession, user_id: UUID, space_id: UUID | None) -> None:
    if space_id is None:
        return
    owned(session, TravelSpace, space_id, user_id)


@router.get("/travel-spaces", response_model=list[TravelSpaceOut])
def list_spaces(
    user: CurrentUser,
    session: DbSession,
    archived: bool = False,
) -> list[TravelSpaceOut]:
    """Active list by default; `archived=true` lists only archived spaces."""
    status_filter = (
        TravelSpace.status == TravelSpaceStatus.archived
        if archived
        else TravelSpace.status != TravelSpaceStatus.archived
    )
    spaces = session.scalars(
        select(TravelSpace)
        .where(TravelSpace.user_id == user.id, status_filter)
        .options(selectinload(TravelSpace.destination))
        .order_by(TravelSpace.start_date, TravelSpace.created_at)
    ).all()
    return [_space_out(space) for space in spaces]


@router.post("/travel-spaces", response_model=TravelSpaceOut, status_code=201)
def create_space(payload: TravelSpaceIn, user: CurrentUser, session: DbSession) -> TravelSpaceOut:
    ensure_date_order(payload.start_date, payload.end_date)
    destination = find_or_create_destination(session, payload.destination_name, payload.country_code)
    space = TravelSpace(
        user_id=user.id,
        title=payload.title.strip(),
        kind=payload.kind,
        status=payload.status,
        start_date=payload.start_date,
        end_date=payload.end_date,
        destination_id=destination.id if destination else None,
        summary=payload.summary,
    )
    session.add(space)
    session.commit()
    session.refresh(space)
    return _space_out(space)


@router.get("/travel-spaces/{space_id}", response_model=TravelSpaceOut)
def read_space(space_id: UUID, user: CurrentUser, session: DbSession) -> TravelSpaceOut:
    space = owned(session, TravelSpace, space_id, user.id)
    return _space_out(space)


@router.patch("/travel-spaces/{space_id}", response_model=TravelSpaceOut)
def update_space(
    space_id: UUID, payload: TravelSpacePatch, user: CurrentUser, session: DbSession
) -> TravelSpaceOut:
    space = owned(session, TravelSpace, space_id, user.id)
    sent = payload.model_fields_set
    for required in ("title", "kind", "status"):
        if required in sent and getattr(payload, required) is None:
            raise AppError(422, f"{required.capitalize()} cannot be empty.")
    if "title" in sent:
        space.title = payload.title.strip()
    for name in ("kind", "status", "start_date", "end_date", "summary"):
        if name in sent:
            setattr(space, name, getattr(payload, name))
    ensure_date_order(space.start_date, space.end_date)
    if "destination_name" in sent:
        current = space.destination
        if current is None or (payload.destination_name or "").strip().lower() != current.name.lower():
            destination = find_or_create_destination(
                session, payload.destination_name, payload.country_code
            )
            space.destination_id = destination.id if destination else None
    session.commit()
    session.refresh(space)
    return _space_out(space)


@router.post("/travel-spaces/{space_id}/merge", response_model=TravelSpaceOut)
def merge_space(
    space_id: UUID, payload: MergeIn, user: CurrentUser, session: DbSession
) -> TravelSpaceOut:
    """Move everything from another space into this one, then archive the other space."""
    target = owned(session, TravelSpace, space_id, user.id)
    source = owned(session, TravelSpace, payload.from_space_id, user.id)
    if source.id == target.id:
        raise AppError(422, "Choose a different space to merge in.")
    merge_spaces(session, source, target)
    session.commit()
    session.refresh(target)
    return _space_out(target)


@router.delete("/travel-spaces/{space_id}", status_code=204)
@router.post("/travel-spaces/{space_id}/archive", status_code=204)
def archive_space(space_id: UUID, user: CurrentUser, session: DbSession) -> None:
    """Archiving hides a space; nothing inside it is deleted, so it can be restored."""
    space = owned(session, TravelSpace, space_id, user.id)
    space.status = TravelSpaceStatus.archived
    session.commit()


@router.post("/travel-spaces/{space_id}/restore", response_model=TravelSpaceOut)
def restore_space(space_id: UUID, user: CurrentUser, session: DbSession) -> TravelSpaceOut:
    space = owned(session, TravelSpace, space_id, user.id)
    if space.status == TravelSpaceStatus.archived:
        space.status = status_from_dates(space.start_date, space.end_date, date.today())
        session.commit()
        session.refresh(space)
    return _space_out(space)


@router.get("/travel-spaces/{space_id}/coverage", response_model=StayCoverageOut)
def space_coverage(space_id: UUID, user: CurrentUser, session: DbSession) -> StayCoverageOut:
    space = owned(session, TravelSpace, space_id, user.id)
    bookings = list(
        session.scalars(
            select(Booking).where(Booking.user_id == user.id, Booking.travel_space_id == space.id)
        ).all()
    )
    stays = list(
        session.scalars(
            select(Stay).where(Stay.user_id == user.id, Stay.travel_space_id == space.id)
        ).all()
    )
    journeys = list(
        session.scalars(
            select(Journey).where(Journey.user_id == user.id, Journey.travel_space_id == space.id)
        ).all()
    )
    return StayCoverageOut.model_validate(
        compute_coverage(space.start_date, space.end_date, bookings, stays, journeys),
        from_attributes=True,
    )


@router.get("/travel-spaces/{space_id}/stays", response_model=list[StayOut])
def list_stays(space_id: UUID, user: CurrentUser, session: DbSession) -> list[Stay]:
    owned(session, TravelSpace, space_id, user.id)
    return list(
        session.scalars(
            select(Stay).where(Stay.user_id == user.id, Stay.travel_space_id == space_id)
        ).all()
    )


@router.post("/stays", response_model=StayOut, status_code=201)
def create_stay(payload: StayIn, user: CurrentUser, session: DbSession) -> Stay:
    _require_space(session, user.id, payload.travel_space_id)
    ensure_date_order(payload.start_date, payload.end_date)
    destination = find_or_create_destination(session, payload.destination_name, payload.country_code)
    stay = Stay(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        title=payload.title.strip(),
        accommodation_type=payload.accommodation_type,
        destination_id=destination.id if destination else None,
        start_date=payload.start_date,
        end_date=payload.end_date,
        notes=payload.notes,
    )
    session.add(stay)
    session.flush()
    sync_stay_itinerary(session, stay)
    session.commit()
    session.refresh(stay)
    return stay


@router.delete("/stays/{stay_id}", status_code=204)
def delete_stay(stay_id: UUID, user: CurrentUser, session: DbSession) -> None:
    stay = owned(session, Stay, stay_id, user.id)
    session.delete(stay)
    session.commit()


@router.post("/journeys", response_model=JourneyOut, status_code=201)
def create_journey(payload: JourneyIn, user: CurrentUser, session: DbSession) -> Journey:
    _require_space(session, user.id, payload.travel_space_id)
    ensure_date_order(payload.depart_on, payload.arrive_on, "arrival date")
    journey = Journey(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        origin_label=payload.origin_label.strip(),
        destination_label=payload.destination_label.strip(),
        mode=payload.mode,
        depart_on=payload.depart_on,
        arrive_on=payload.arrive_on,
        notes=payload.notes,
    )
    session.add(journey)
    session.flush()
    sync_journey_itinerary(session, journey)
    session.commit()
    session.refresh(journey)
    return journey


@router.get("/travel-spaces/{space_id}/journeys", response_model=list[JourneyOut])
def list_journeys(space_id: UUID, user: CurrentUser, session: DbSession) -> list[Journey]:
    owned(session, TravelSpace, space_id, user.id)
    return list(
        session.scalars(
            select(Journey)
            .where(Journey.user_id == user.id, Journey.travel_space_id == space_id)
            .order_by(Journey.depart_on)
        ).all()
    )


@router.delete("/journeys/{journey_id}", status_code=204)
def delete_journey(journey_id: UUID, user: CurrentUser, session: DbSession) -> None:
    journey = owned(session, Journey, journey_id, user.id)
    session.delete(journey)
    session.commit()


@router.get("/destinations", response_model=list[DestinationOut])
def search_destinations(
    session: DbSession,
    user: CurrentUser,
    q: str = Query(default="", max_length=160),
) -> list[Destination]:
    _ = user
    statement = select(Destination).order_by(Destination.name).limit(30)
    if q.strip():
        statement = statement.where(func.lower(Destination.name).contains(q.strip().lower()))
    return list(session.scalars(statement).all())


@router.post("/destinations", response_model=DestinationOut, status_code=201)
def create_destination(payload: DestinationIn, user: CurrentUser, session: DbSession) -> Destination:
    _ = user
    try:
        kind = DestinationKind(payload.kind)
    except ValueError as exc:
        raise AppError(422, "Unknown destination kind.") from exc
    destination = find_or_create_destination(session, payload.name, payload.country_code, kind)
    assert destination is not None
    if payload.latitude is not None:
        destination.latitude = payload.latitude
        destination.longitude = payload.longitude
    session.commit()
    session.refresh(destination)
    return destination


@router.get("/saved-places", response_model=list[SavedPlaceOut])
def list_saved(
    user: CurrentUser,
    session: DbSession,
    travel_space_id: UUID | None = None,
) -> list[SavedPlaceOut]:
    statement = (
        select(SavedPlace)
        .where(SavedPlace.user_id == user.id)
        .options(selectinload(SavedPlace.location))
        .order_by(SavedPlace.created_at)
    )
    if travel_space_id is not None:
        owned(session, TravelSpace, travel_space_id, user.id)
        statement = statement.where(
            or_(SavedPlace.travel_space_id == travel_space_id, SavedPlace.travel_space_id.is_(None))
        )
    places = session.scalars(statement).all()
    return [_saved_out(place) for place in places]


@router.post("/saved-places", response_model=SavedPlaceOut, status_code=201)
def create_saved(payload: SavedPlaceIn, user: CurrentUser, session: DbSession) -> SavedPlaceOut:
    _require_space(session, user.id, payload.travel_space_id)
    destination = find_or_create_destination(session, payload.destination_name, payload.country_code)
    location = Location(
        created_by_user_id=user.id,
        destination_id=destination.id if destination else None,
        name=payload.name.strip(),
        category=payload.category,
        address=payload.address,
        country_code=payload.country_code.upper() if payload.country_code else None,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    session.add(location)
    session.flush()
    place = SavedPlace(
        user_id=user.id,
        location_id=location.id,
        travel_space_id=payload.travel_space_id,
        status=payload.status,
        notes=payload.notes,
    )
    session.add(place)
    session.commit()
    session.refresh(place)
    place.location = location
    return _saved_out(place)


@router.patch("/saved-places/{place_id}", response_model=SavedPlaceOut)
def update_saved(
    place_id: UUID, payload: SavedPlaceStatusIn, user: CurrentUser, session: DbSession
) -> SavedPlaceOut:
    place = owned(session, SavedPlace, place_id, user.id)
    place.status = payload.status
    session.commit()
    session.refresh(place)
    return _saved_out(place)


@router.delete("/saved-places/{place_id}", status_code=204)
def delete_saved(place_id: UUID, user: CurrentUser, session: DbSession) -> None:
    place = owned(session, SavedPlace, place_id, user.id)
    session.delete(place)
    session.commit()


def _saved_out(place: SavedPlace) -> SavedPlaceOut:
    location = place.location
    return SavedPlaceOut(
        id=place.id,
        name=location.name,
        category=location.category,
        address=location.address,
        latitude=location.latitude,
        longitude=location.longitude,
        travel_space_id=place.travel_space_id,
        status=place.status,
        notes=place.notes,
    )
