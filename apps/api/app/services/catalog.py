from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Destination, DestinationKind


def find_or_create_destination(
    session: Session,
    name: str | None,
    country_code: str | None,
    kind: DestinationKind = DestinationKind.city,
) -> Destination | None:
    if name is None or not name.strip():
        return None
    cleaned = name.strip()
    country = country_code.upper() if country_code else None
    existing = session.scalar(
        select(Destination).where(
            func.lower(Destination.name) == cleaned.lower(),
            Destination.country_code == country,
            Destination.kind == kind,
        )
    )
    if existing is not None:
        return existing
    destination = Destination(name=cleaned, country_code=country, kind=kind)
    session.add(destination)
    session.flush()
    return destination
