from dataclasses import dataclass
from datetime import date

from app.models.entities import TravelSpace, TravelSpaceKind, TravelSpaceStatus

SHORT_STAY_DAYS = 21
POST_TRIP_DAYS = 14


@dataclass(frozen=True)
class FocusItem:
    key: str
    label: str
    available: bool


@dataclass(frozen=True)
class DashboardMode:
    mode: str
    travel_space: TravelSpace | None
    headline: str
    focus: list[FocusItem]


def determine_dashboard(spaces: list[TravelSpace], today: date) -> DashboardMode:
    visible = [space for space in spaces if space.status != TravelSpaceStatus.archived]
    current = _current_space(visible, today)
    if current is not None:
        if current.status == TravelSpaceStatus.planning:
            return _mode("planning", current, f"Planning {current.title}")
        if current.status == TravelSpaceStatus.upcoming and (
            current.start_date is None or current.start_date > today
        ):
            return _mode("upcoming", current, f"Upcoming · {current.title}")
        if current.status == TravelSpaceStatus.paused:
            return _mode("paused", current, f"Paused · {current.title}")
        if _is_long_stay(current):
            return _mode("long_stay", current, f"Living in { _place(current) }")
        return _mode("short_holiday", current, f"Today in { _place(current) }")

    completed = [
        space
        for space in visible
        if space.status == TravelSpaceStatus.completed and space.end_date is not None
    ]
    completed.sort(key=lambda space: space.end_date or date.min, reverse=True)
    if completed and (today - completed[0].end_date).days <= POST_TRIP_DAYS:
        return _mode("post_trip", completed[0], f"Back from { _place(completed[0]) }")
    return DashboardMode(
        mode="at_home",
        travel_space=None,
        headline="At home",
        focus=_focus("at_home"),
    )


def _current_space(spaces: list[TravelSpace], today: date) -> TravelSpace | None:
    rank = {
        TravelSpaceStatus.active: 0,
        TravelSpaceStatus.paused: 1,
        TravelSpaceStatus.upcoming: 2,
        TravelSpaceStatus.planning: 3,
    }

    def covers(space: TravelSpace) -> bool:
        if space.status in (TravelSpaceStatus.active, TravelSpaceStatus.paused):
            return True
        if space.start_date is None:
            return space.status == TravelSpaceStatus.planning
        if space.end_date is None:
            return space.start_date <= today or space.status in (
                TravelSpaceStatus.upcoming,
                TravelSpaceStatus.planning,
            )
        return space.start_date <= today <= space.end_date or space.status in (
            TravelSpaceStatus.upcoming,
            TravelSpaceStatus.planning,
        )

    candidates = [space for space in spaces if space.status in rank and covers(space)]
    if not candidates:
        return None
    candidates.sort(key=lambda space: (rank[space.status], space.start_date or date.max))
    active_now = [
        space
        for space in candidates
        if space.status == TravelSpaceStatus.active
        or (
            space.start_date is not None
            and space.start_date <= today
            and (space.end_date is None or space.end_date >= today)
            and space.status in (TravelSpaceStatus.active, TravelSpaceStatus.upcoming)
        )
    ]
    if active_now:
        active_now.sort(key=lambda space: (0 if space.status == TravelSpaceStatus.active else 1,))
        return active_now[0]
    return candidates[0]


def _is_long_stay(space: TravelSpace) -> bool:
    if space.kind in (
        TravelSpaceKind.long_stay,
        TravelSpaceKind.relocation,
        TravelSpaceKind.open_ended,
    ):
        return True
    if space.end_date is None:
        return True
    if space.start_date is None:
        return False
    return (space.end_date - space.start_date).days > SHORT_STAY_DAYS


def _place(space: TravelSpace) -> str:
    if space.destination is not None:
        return space.destination.name
    return space.title


def _mode(mode: str, space: TravelSpace, headline: str) -> DashboardMode:
    return DashboardMode(mode=mode, travel_space=space, headline=headline, focus=_focus(mode))


def _focus(mode: str) -> list[FocusItem]:
    catalog = {
        "at_home": [
            ("spaces", "Travel Spaces", True),
            ("saved", "Saved places", True),
            ("discover", "Discover", False),
            ("history", "Travel history", True),
        ],
        "planning": [
            ("itinerary", "Itinerary", True),
            ("bookings", "Bookings", True),
            ("saved", "Saved places", True),
            ("assistant", "Assistant", True),
            ("budget", "Budget", False),
        ],
        "upcoming": [
            ("itinerary", "Itinerary", True),
            ("bookings", "Bookings and tickets", True),
            ("assistant", "Assistant", True),
            ("documents", "Documents", False),
        ],
        "short_holiday": [
            ("today", "Today", True),
            ("bookings", "Bookings", True),
            ("itinerary", "Itinerary", True),
            ("assistant", "Assistant", True),
            ("expenses", "Expenses", False),
        ],
        "long_stay": [
            ("accommodation", "Current stay", True),
            ("itinerary", "Plans", True),
            ("saved", "Local places", True),
            ("assistant", "Assistant", True),
            ("budget", "Monthly budget", False),
            ("visa", "Visa and stay", False),
        ],
        "paused": [
            ("spaces", "Travel Space", True),
            ("bookings", "Bookings", True),
            ("assistant", "Assistant", True),
        ],
        "post_trip": [
            ("itinerary", "What you did", True),
            ("bookings", "Bookings", True),
            ("memories", "Memories", False),
            ("expenses", "Expenses", False),
        ],
    }
    return [FocusItem(*item) for item in catalog[mode]]
