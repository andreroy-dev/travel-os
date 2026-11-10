from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import AppError


def ensure_date_order(start: date | None, end: date | None, label: str = "end date") -> None:
    if start is not None and end is not None and end < start:
        raise AppError(422, f"The {label} cannot be before the start date.")


def ensure_datetime_order(start: datetime | None, end: datetime | None) -> None:
    if start is not None and end is not None and end < start:
        raise AppError(422, "The end time cannot be before the start time.")


def ensure_timezone(name: str | None) -> str | None:
    if name is None or name == "":
        return None
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise AppError(422, f"Unknown time zone: {name}") from exc
    return name


def ensure_currency(code: str | None) -> str | None:
    if code is None or code == "":
        return None
    cleaned = code.strip().upper()
    if len(cleaned) != 3 or not cleaned.isalpha():
        raise AppError(422, "Currency must be a three-letter code.")
    return cleaned
