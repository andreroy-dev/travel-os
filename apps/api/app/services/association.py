import uuid
from dataclasses import dataclass
from datetime import date

from app.models.entities import TravelSpace, TravelSpaceStatus


@dataclass(frozen=True)
class SpaceMatch:
    travel_space_id: uuid.UUID
    score: int


def match_travel_space(
    spaces: list[TravelSpace],
    start: date | None,
    end: date | None,
) -> uuid.UUID | None:
    if start is None:
        return None
    item_end = end or start
    best: SpaceMatch | None = None
    for space in spaces:
        if space.status == TravelSpaceStatus.archived or space.start_date is None:
            continue
        if space.end_date is None:
            score = 1 if start >= space.start_date else 0
        else:
            score = _overlap_days(start, item_end, space.start_date, space.end_date)
        if score <= 0:
            continue
        if best is None or score > best.score:
            best = SpaceMatch(space.id, score)
    return best.travel_space_id if best else None


def _overlap_days(a_start: date, a_end: date, b_start: date, b_end: date) -> int:
    start = max(a_start, b_start)
    end = min(a_end, b_end)
    if end < start:
        return 0
    return (end - start).days + 1
