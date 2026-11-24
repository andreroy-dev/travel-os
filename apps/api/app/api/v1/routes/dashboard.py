from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.models.entities import ItineraryItem, TravelSpace
from app.schemas import DashboardOut, FocusOut, ItineraryOut, TravelSpaceOut
from app.services.dashboard import determine_dashboard
from app.services.dashboard_situation import build_situation

router = APIRouter()


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: CurrentUser, session: DbSession) -> DashboardOut:
    today = datetime.now(UTC).date()
    spaces = list(
        session.scalars(
            select(TravelSpace)
            .where(TravelSpace.user_id == user.id)
            .options(selectinload(TravelSpace.destination))
        ).all()
    )
    mode = determine_dashboard(spaces, today)
    space = mode.travel_space
    today_items: list[ItineraryItem] = []
    if space is not None:
        today_items = list(
            session.scalars(
                select(ItineraryItem).where(
                    ItineraryItem.user_id == user.id,
                    ItineraryItem.travel_space_id == space.id,
                    ItineraryItem.starts_on == today,
                )
            ).all()
        )
    travel_space = None
    if space is not None:
        travel_space = TravelSpaceOut(
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
    return DashboardOut(
        mode=mode.mode,
        headline=mode.headline,
        travel_space=travel_space,
        focus=[FocusOut(key=item.key, label=item.label, available=item.available) for item in mode.focus],
        today=[ItineraryOut.model_validate(item, from_attributes=True) for item in today_items],
        situation=build_situation(session, user.id, space, spaces, today),
    )
