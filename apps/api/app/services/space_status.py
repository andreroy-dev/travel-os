from datetime import date

from app.models.entities import TravelSpaceStatus


def status_from_dates(start: date | None, end: date | None, today: date) -> TravelSpaceStatus:
    """Status a space should take when it comes back from the archive."""
    if start is None:
        return TravelSpaceStatus.planning
    if start > today:
        return TravelSpaceStatus.upcoming
    if end is not None and end < today:
        return TravelSpaceStatus.completed
    return TravelSpaceStatus.active
