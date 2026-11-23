"""Read the confirmation layouts we already see from Booking.com, Agoda, and Cleartrip."""

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from app.models.entities import BookingCategory
from app.services.booking_details import normalize_details
from app.services.extraction import ExtractedBooking, _parse_date

_WEEKDAY = r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*"
_DATE_LINES = (
    re.compile(
        rf"({_WEEKDAY},?\s+[A-Za-z]+\s+\d{{1,2}},?\s+\d{{4}})(?:\s+(\d{{1,2}}:\d{{2}}))?",
        re.IGNORECASE,
    ),
    re.compile(
        rf"({_WEEKDAY},?\s+\d{{1,2}}\s+[A-Za-z]{{3,9}}\s+\d{{4}})(?:\s+(\d{{1,2}}:\d{{2}}))?",
        re.IGNORECASE,
    ),
)
_FLIGHT_CODE = re.compile(r"^([A-Z]{2})\s*-\s*(\d{2,4})$")
_MONEY_LINE = re.compile(r"^(€|£|\$|₹)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)$")
_CURRENCY = {"€": "EUR", "£": "GBP", "$": "USD", "₹": "INR"}


def apply_known_provider(text: str, extracted: ExtractedBooking) -> None:
    if _apply_smartbuy(text, extracted):
        return
    if _apply_booking_com(text, extracted):
        return
    _apply_agoda(text, extracted)


def _apply_booking_com(text: str, extracted: ExtractedBooking) -> bool:
    if "total price" not in text.lower() or not re.search(r"check-in\s+", text, re.IGNORECASE):
        return False
    check_in = re.search(
        r"Check-in\s+([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\((?:from\s+)?(\d{1,2}:\d{2}\s*[AP]M)",
        text,
        re.IGNORECASE,
    )
    check_out = re.search(
        r"Check-out\s+([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\(([^)]+)\)",
        text,
        re.IGNORECASE,
    )
    if check_in is None or check_out is None:
        return False
    room = re.search(r"Your reservation\s+\d+\s+nights?,\s+([^\n]+)", text, re.IGNORECASE)
    total = re.search(
        r"Total Price\s*\n+\s*(€|£|\$|₹)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)",
        text,
        re.IGNORECASE,
    )
    pin = re.search(r"\bPIN:\s*(\d{4,8})", text, re.IGNORECASE)
    start_clock = _clock_12(check_in.group(2))
    end_times = re.findall(r"(\d{1,2}:\d{2}\s*[AP]M)", check_out.group(2), re.IGNORECASE)
    end_clock = _clock_12(end_times[-1]) if end_times else None
    start = _with_clock(_parse_date(check_in.group(1)), start_clock)
    end = _with_clock(_parse_date(check_out.group(1)), end_clock)
    property_name = extracted.location_label or _line_after(text, "Guest name")
    # Property is the place in the subject, already on location_label. Do not use the guest line.
    property_name = extracted.location_label
    details = {
        "property_name": property_name,
        "stay_kind": "hostel" if (property_name and "meininger" in property_name.lower()) or (room and "dormitory" in room.group(1).lower()) else "hotel",
        "check_in_time": start_clock,
        "check_out_time": end_clock,
        "room": room.group(1).strip(" .") if room else None,
        "guests": _line_after(text, "Guest name"),
        "reservation_pin": pin.group(1) if pin else None,
        "title": property_name,
    }
    _commit_stay(extracted, details, start, end, total.group(1) if total else None, total.group(2) if total else None)
    policy = re.search(r"(You can cancel for free[^\n.]{0,140})", text, re.IGNORECASE)
    if policy:
        extracted.cancellation_policy = re.sub(r"\s+", " ", policy.group(1)).strip()[:240]
    return True


def _apply_agoda(text: str, extracted: ExtractedBooking) -> bool:
    lines = _lines(text)
    try:
        check_in_at = next(index for index, line in enumerate(lines) if line.lower() == "check in")
        check_out_at = next(index for index, line in enumerate(lines) if line.lower() == "check out")
    except StopIteration:
        return False
    if "room type" not in text.lower():
        return False
    start = _parse_date(lines[check_in_at + 1]) if check_in_at + 1 < len(lines) else None
    end = _parse_date(lines[check_out_at + 1]) if check_out_at + 1 < len(lines) else None
    start_clock = _paren_clock(lines[check_in_at + 2] if check_in_at + 2 < len(lines) else "")
    end_clock = _paren_clock(lines[check_out_at + 2] if check_out_at + 2 < len(lines) else "")
    start = _with_clock(start, start_clock)
    end = _with_clock(end, end_clock)
    property_name, address = _agoda_property(lines, check_in_at)
    room = _line_after(text, "Room type")
    symbol, amount = _money_after(lines, "Price Now")
    details = {
        "property_name": property_name,
        "stay_kind": "hostel" if room and "dormitory" in room.lower() else "hotel",
        "address": address,
        "check_in_time": start_clock,
        "check_out_time": end_clock,
        "room": room,
        "guests": _line_after(text, "Lead guest"),
        "title": property_name,
    }
    _commit_stay(extracted, details, start, end, symbol, amount)
    return True


def _apply_smartbuy(text: str, extracted: ExtractedBooking) -> bool:
    lowered = text.lower()
    if "departure flight" not in lowered or "pnr number" not in lowered:
        return False
    lines = _lines(text)
    starts = [index for index, line in enumerate(lines) if line.lower() == "departure flight"]
    segments: list[dict] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        block = []
        for line in lines[start + 1 : end]:
            if line.lower() == "traveller details":
                break
            block.append(line)
        segment = _segment(block)
        if segment:
            segments.append(segment)
    if not segments:
        return False
    booking_id = re.search(r"Booking ID:\s*([A-Z0-9]+)", text, re.IGNORECASE)
    if booking_id:
        extracted.confirmation_reference = booking_id.group(1).upper()
    passenger = next((line for line in lines if re.search(r"\(ADT\)|\(Adult\)", line)), None)
    if passenger:
        passenger = re.sub(r"\s*\((?:ADT|Adult)\)\s*$", "", passenger, flags=re.IGNORECASE)
        passenger = re.sub(r"^(?:Mr|Mrs|Ms|Miss)\.?\s+", "", passenger, flags=re.IGNORECASE).strip()
    first = _segment_moment(segments[0], "departure")
    last = _segment_moment(segments[-1], "arrival") or _segment_moment(segments[-1], "departure")
    origin = segments[0].get("origin")
    destination = segments[-1].get("destination")
    route = f"{origin} → {destination}" if origin and destination else extracted.provider
    flight_number = segments[0].get("flight_number")
    title = f"{flight_number} · {route}" if len(segments) == 1 and flight_number else route
    symbol, amount = _total_after(lines)
    extracted.category = BookingCategory.flight
    extracted.provider = "Cleartrip" if "cleartrip" in lowered else (extracted.provider or "Cleartrip")
    extracted.starts_at = first
    extracted.ends_at = last
    extracted.mentioned_dates = [moment for moment in (first, last) if moment]
    extracted.location_label = title
    if symbol and amount:
        _set_price(extracted, symbol, amount)
    extracted.details = normalize_details(
        BookingCategory.flight.value,
        {
            "airline": segments[0].get("airline"),
            "flight_number": flight_number,
            "origin": origin,
            "origin_code": segments[0].get("origin_code"),
            "destination": destination,
            "destination_code": segments[-1].get("destination_code"),
            "departure_time": segments[0].get("departure_time"),
            "arrival_time": segments[-1].get("arrival_time"),
            "departure_terminal": segments[0].get("departure_terminal"),
            "arrival_terminal": segments[-1].get("arrival_terminal"),
            "cabin": segments[0].get("cabin"),
            "passengers": passenger,
            "title": title,
            "segments": segments,
        },
    )
    return True


def _segment(block: list[str]) -> dict | None:
    route = next((line for line in block[:3] if re.search(r"\bto\b", line, re.IGNORECASE)), "")
    parts = re.split(r"\s+to\s+", route, maxsplit=1, flags=re.IGNORECASE)
    origin = parts[0].strip() if len(parts) == 2 else None
    destination = parts[1].strip() if len(parts) == 2 else None
    flight_number = None
    for line in block:
        match = _FLIGHT_CODE.match(line)
        if match:
            flight_number = f"{match.group(1)}{match.group(2)}"
            break
    if not flight_number and not origin:
        return None
    airline = None
    for line in block:
        if re.fullmatch(r"[A-Z][A-Za-z .'-]{2,40}", line) and "flight" not in line.lower() and line not in {origin, destination}:
            if any(word in line.lower() for word in ("air", "airways", "airlines")):
                airline = line
                break
    pnr = _next_value(block, "PNR Number")
    terminals = [re.sub(r"^Terminal:\s*", "", line, flags=re.IGNORECASE) for line in block if line.lower().startswith("terminal")]
    moments = _moments(block)
    timed = [moment for moment in moments if moment[1]]
    if timed:
        moments = [timed[0], timed[-1]] if len(timed) > 1 else [timed[0]]
    codes = [line for line in block if re.fullmatch(r"[A-Z]{3}", line)]
    cabin = next((line for line in block if line.lower() in {"economy", "business", "first"}), None)
    if cabin is None and any("economy" in line.lower() for line in block):
        cabin = "Economy"
    return {
        "flight_number": flight_number,
        "airline": airline,
        "origin": origin,
        "destination": destination,
        "origin_code": codes[0] if codes else None,
        "destination_code": codes[1] if len(codes) > 1 else None,
        "departure_time": moments[0][1] if moments else None,
        "arrival_time": moments[-1][1] if len(moments) > 1 else None,
        "departure_at": moments[0][0].isoformat() if moments else None,
        "arrival_at": moments[-1][0].isoformat() if len(moments) > 1 else None,
        "departure_terminal": terminals[0] if terminals else None,
        "arrival_terminal": terminals[1] if len(terminals) > 1 else None,
        "cabin": cabin,
        "pnr": pnr,
    }


def _moments(block: list[str]) -> list[tuple[datetime, str | None]]:
    found: list[tuple[datetime, str | None]] = []
    for index, line in enumerate(block):
        match = next((hit for pattern in _DATE_LINES if (hit := pattern.search(line))), None)
        if match is None:
            continue
        clock = match.group(2)
        if clock is None and index > 0 and re.fullmatch(r"\d{1,2}:\d{2}", block[index - 1]):
            clock = block[index - 1]
        parsed = _parse_date(match.group(1))
        if parsed is None:
            continue
        parsed = _with_clock(parsed, _clock_24(clock) if clock else None)
        if parsed is not None:
            found.append((parsed, _clock_24(clock) if clock else None))
    return found


def _segment_moment(segment: dict, which: str) -> datetime | None:
    raw = segment.get("departure_at" if which == "departure" else "arrival_at")
    if not raw:
        return None
    parsed = _parse_date(raw[:10]) if len(raw) >= 10 else None
    if parsed is None:
        return None
    clock = segment.get("departure_time" if which == "departure" else "arrival_time")
    return _with_clock(parsed, clock)


def _commit_stay(
    extracted: ExtractedBooking,
    details: dict,
    start: datetime | None,
    end: datetime | None,
    symbol: str | None,
    amount: str | None,
) -> None:
    extracted.category = BookingCategory.accommodation
    if start:
        extracted.starts_at = start
    if end:
        extracted.ends_at = end
    extracted.mentioned_dates = [moment for moment in (start, end) if moment]
    if details.get("title"):
        extracted.location_label = str(details["title"])[:240]
    if symbol and amount:
        _set_price(extracted, symbol, amount)
    extracted.details = normalize_details(BookingCategory.accommodation.value, details)


def _agoda_property(lines: list[str], check_in_at: int) -> tuple[str | None, str | None]:
    cursor = check_in_at - 1
    skipped = {"directions", "&nbsp;"}
    while cursor >= 0 and lines[cursor].lower() in skipped:
        cursor -= 1
    if cursor < 0:
        return None, None
    address = lines[cursor] if _looks_like_address(lines[cursor]) else None
    if address is None:
        return lines[cursor], None
    cursor -= 1
    while cursor >= 0 and (lines[cursor].lower() in skipped or _looks_like_address(lines[cursor])):
        cursor -= 1
    property_name = lines[cursor] if cursor >= 0 else None
    return property_name, address


def _looks_like_address(value: str) -> bool:
    return "," in value and any(character.isdigit() for character in value)


def _lines(text: str) -> list[str]:
    cleaned = []
    for raw in text.splitlines():
        line = raw.strip().strip("|").strip()
        if line and line.lower() != "&nbsp;":
            cleaned.append(line)
    return cleaned


def _line_after(text: str, label: str) -> str | None:
    lines = _lines(text)
    return _next_value(lines, label)


def _next_value(lines: list[str], label: str) -> str | None:
    for index, line in enumerate(lines):
        if line.lower().rstrip(":") != label.lower():
            continue
        for candidate in lines[index + 1 : index + 4]:
            if not candidate or candidate.startswith("("):
                continue
            if any(mark in candidate.lower() for mark in ("€", "$", "£", "₹", "cost", "breakfast", "total")):
                continue
            return candidate[:160]
    return None


def _paren_clock(value: str) -> str | None:
    times = re.findall(r"(\d{1,2}:\d{2}\s*[AP]M)", value, re.IGNORECASE)
    if not times:
        return None
    return _clock_12(times[-1])


def _clock_12(value: str) -> str | None:
    match = re.match(r"(\d{1,2}):(\d{2})\s*([AP]M)", value.strip(), re.IGNORECASE)
    if match is None:
        return _clock_24(value)
    hour = int(match.group(1)) % 12
    if match.group(3).upper() == "PM":
        hour += 12
    return f"{hour:02d}:{match.group(2)}"


def _clock_24(value: str | None) -> str | None:
    if not value:
        return None
    match = re.match(r"(\d{1,2}):(\d{2})", value.strip())
    if match is None:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _with_clock(moment: datetime | None, clock: str | None) -> datetime | None:
    if moment is None:
        return None
    if not clock:
        return moment
    hour, minute = (int(part) for part in clock.split(":"))
    return moment.replace(hour=hour, minute=minute)


def _split_money(value: str) -> tuple[str | None, str | None]:
    match = _MONEY_LINE.match(value.strip())
    if match is None:
        return None, None
    return match.group(1), match.group(2)


def _money_after(lines: list[str], label: str) -> tuple[str | None, str | None]:
    for index, line in enumerate(lines):
        if line.lower() != label.lower():
            continue
        for candidate in lines[index + 1 : index + 4]:
            symbol, amount = _split_money(candidate)
            if symbol:
                return symbol, amount
    return None, None


def _total_after(lines: list[str]) -> tuple[str | None, str | None]:
    for index, line in enumerate(lines):
        if line.lower() != "total" or index + 1 >= len(lines):
            continue
        symbol, amount = _split_money(lines[index + 1])
        if symbol:
            return symbol, amount
    return None, None


def _set_price(extracted: ExtractedBooking, symbol: str, amount: str) -> None:
    try:
        extracted.price_amount = Decimal(amount.replace(",", ""))
        extracted.price_currency = _CURRENCY.get(symbol)
    except InvalidOperation:
        extracted.price_amount = None
