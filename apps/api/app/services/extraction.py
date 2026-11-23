import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from dateutil import parser as date_parser

from app.models.entities import BookingCategory, BookingStatus, EmailClassification
from app.services.booking_details import normalize_details

_PROMO_PHRASES = (
    "unsubscribe",
    "view in browser",
    "book now",
    "% off",
    "discount",
    "genius level",
    "exclusive offer",
    "limited time",
    "don't miss",
    "do not miss",
    "special offer",
    "deals for you",
    "price drop",
    "newsletter",
    "still available",
)
_CONFIRMED_SUBJECT = ("confirmed", "confirmation", "e-ticket", "eticket", "itinerary", "boarding pass", "booking reference")
_FLIGHT_NUMBER = re.compile(r"\b([A-Z]{2})\s?(\d{2,4})\b")
_ROUTE = re.compile(
    r"(?:from|depart(?:s|ing)?(?:\s+from)?)\s+"
    r"([A-Z][A-Za-z .'-]{1,40}?)"
    r"(?:\s+\(([A-Z]{3})\))?"
    r"\s+(?:to|→)\s+"
    r"([A-Z][A-Za-z .'-]{1,40})"
    r"(?:\s+\(([A-Z]{3})\))?"
)
_CODED_ROUTE = re.compile(
    r"([A-Z][A-Za-z .'-]{2,40})\s+\(([A-Z]{3})\)\s+(?:to|→)\s+([A-Z][A-Za-z .'-]{2,40})\s+\(([A-Z]{3})\)"
)
_AIRLINES = (
    "Lufthansa",
    "Ryanair",
    "easyJet",
    "Emirates",
    "Qatar Airways",
    "British Airways",
    "Air France",
    "KLM",
    "Swiss",
    "Austrian Airlines",
    "Turkish Airlines",
    "IndiGo",
    "Air India",
    "Vistara",
    "Singapore Airlines",
    "United Airlines",
    "Delta",
    "American Airlines",
    "Wizz Air",
    "Eurowings",
    "Smartwings",
    "Czech Airlines",
)
_CABINS = ("premium economy", "economy", "business", "first class")

_BOOKING_WORDS = (
    "confirmation",
    "booking",
    "reservation",
    "itinerary",
    "e-ticket",
    "eticket",
    "check-in",
    "check in",
    "check-out",
    "check out",
    "pnr",
    "voucher",
    "ticket",
)
_KNOWN_PROVIDERS = (
    ("Booking.com", ("booking.com",)),
    ("Agoda", ("agoda",)),
    ("Cleartrip", ("cleartrip",)),
    ("GetYourGuide", ("getyourguide", "get your guide")),
    ("Trivago", ("trivago",)),
    ("Expedia", ("expedia",)),
    ("Hotels.com", ("hotels.com",)),
    ("Airbnb", ("airbnb",)),
    ("Kayak", ("kayak",)),
    ("Skyscanner", ("skyscanner",)),
    ("MakeMyTrip", ("makemytrip", "make my trip")),
    ("Goibibo", ("goibibo",)),
    ("ixigo", ("ixigo",)),
    ("Yatra", ("yatra.com",)),
    ("Viator", ("viator",)),
    ("Klook", ("klook",)),
    ("Hostelworld", ("hostelworld",)),
    ("Vrbo", ("vrbo",)),
    ("Trip.com", ("trip.com",)),
    ("Omio", ("omio",)),
    ("Trainline", ("trainline",)),
    ("FlixBus", ("flixbus",)),
    ("Kiwi.com", ("kiwi.com",)),
    ("Opodo", ("opodo",)),
    ("lastminute.com", ("lastminute.com",)),
    ("Rentalcars.com", ("rentalcars",)),
    ("DiscoverCars", ("discovercars",)),
)
_CANCEL_PHRASES = (
    "has been cancelled",
    "has been canceled",
    "was cancelled",
    "was canceled",
    "is now cancelled",
    "is now canceled",
    "booking cancelled",
    "booking canceled",
    "reservation cancelled",
    "reservation canceled",
    "cancellation of your",
)
_MODIFY_WORDS = ("modified", "rescheduled", "rebooked", "change to your booking", "updated reservation")

_CONFIRMATION = re.compile(
    r"(?:confirmation|booking|reservation|record locator|pnr)"
    r"(?:\s+(?:number|code|id|no\.?|reference|#))?"
    r"\s*[:#]?\s*([A-Z0-9-]*\d[A-Z0-9-]{3,})",
    re.IGNORECASE,
)
_MONTH = (
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    "aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
_DATE = re.compile(
    rf"""(
        \d{{4}}-\d{{2}}-\d{{2}}
        | \d{{1,2}}[./]\d{{1,2}}[./]\d{{2,4}}
        | \d{{1,2}}\s+(?:{_MONTH})\s+\d{{4}}
        | (?:{_MONTH})\s+\d{{1,2}},?\s+\d{{4}}
        | \d{{1,2}}(?:{_MONTH})\d{{4}}
        | \d{{1,2}}\s*(?:{_MONTH})(?!\w)
    )""",
    re.IGNORECASE | re.VERBOSE,
)
_MONEY = re.compile(
    r"(?:total|price|amount|paid)\s*[:#]?\s*"
    r"(?:(USD|EUR|GBP|AUD|CAD|INR|JPY|SGD|CHF|NZD)\s*)?"
    r"([0-9]+(?:[.,][0-9]{2})?)"
    r"(?:\s*(USD|EUR|GBP|AUD|CAD|INR|JPY|SGD|CHF|NZD))?",
    re.IGNORECASE,
)
_LABELED = {
    "location": re.compile(
        r"(?:hotel|property|accommodation|address|venue|restaurant)\s*[:\-]\s*(.+)",
        re.IGNORECASE,
    ),
    "provider": re.compile(r"(?:provider|booked with|airline|operator)\s*[:\-]\s*(.+)", re.IGNORECASE),
}


@dataclass
class ExtractedBooking:
    category: BookingCategory = BookingCategory.other
    provider: str | None = None
    confirmation_reference: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    location_label: str | None = None
    price_amount: Decimal | None = None
    price_currency: str | None = None
    cancellation_policy: str | None = None
    status: BookingStatus = BookingStatus.confirmed
    missing_fields: list[str] = field(default_factory=list)
    mentioned_dates: list[datetime] = field(default_factory=list)
    details: dict = field(default_factory=dict)

    @property
    def is_actionable(self) -> bool:
        return bool(self.confirmation_reference or self.starts_at or self.mentioned_dates)


def classify_email(subject: str, body: str) -> EmailClassification:
    text = f"{subject}\n{body}".lower()
    if _provider_name(text) is None and not any(word in text for word in _BOOKING_WORDS):
        return EmailClassification.ignored
    # A confirmation almost always mentions the cancellation policy. Only a
    # subject, or a sentence that says the booking was cancelled, counts.
    subject_lower = subject.lower()
    if any(word in subject_lower for word in ("cancelled", "canceled", "cancellation")):
        return EmailClassification.cancellation
    if any(phrase in text for phrase in _CANCEL_PHRASES):
        return EmailClassification.cancellation
    if any(word in text for word in _MODIFY_WORDS):
        return EmailClassification.modification
    return EmailClassification.confirmation


def extract_booking(subject: str, body: str, classification: EmailClassification) -> ExtractedBooking:
    text = f"{subject}\n{body}"
    extracted = ExtractedBooking(category=_category_from_text(text))
    confirmation = _CONFIRMATION.search(text)
    if confirmation:
        extracted.confirmation_reference = confirmation.group(1).strip().upper()

    labeled_start, labeled_end, dates = _travel_dates(text)
    extracted.mentioned_dates = dates
    extracted.starts_at = labeled_start or (dates[0] if dates else None)
    extracted.ends_at = labeled_end or (dates[1] if len(dates) > 1 else None)

    money = _MONEY.search(text)
    if money:
        currency = (money.group(1) or money.group(3) or "").upper() or None
        amount_raw = money.group(2).replace(",", "")
        try:
            extracted.price_amount = Decimal(amount_raw)
            extracted.price_currency = currency
        except InvalidOperation:
            extracted.price_amount = None

    for key, pattern in _LABELED.items():
        match = pattern.search(text)
        if not match:
            continue
        value = match.group(1).strip()
        if key == "location":
            extracted.location_label = value[:240]
        else:
            extracted.provider = value[:160]

    if extracted.provider is None:
        extracted.provider = _provider_name(text.lower()) or _provider_from_subject(subject)
    if extracted.location_label is None:
        extracted.location_label = _place_from_subject(subject)
    extracted.category = _category_from_text(text)
    extracted.cancellation_policy = _cancellation_policy(text)
    extracted.details = _structured_details(text, extracted)
    _apply_clocks(extracted)
    from app.services.provider_parse import apply_known_provider

    apply_known_provider(text, extracted)
    if extracted.details.get("title"):
        extracted.location_label = str(extracted.details["title"])[:240]

    if classification == EmailClassification.cancellation:
        extracted.status = BookingStatus.cancelled
    elif classification == EmailClassification.modification:
        extracted.status = BookingStatus.modified

    if not extracted.confirmation_reference:
        extracted.missing_fields.append("confirmation_reference")
    if extracted.starts_at is None and classification != EmailClassification.cancellation:
        extracted.missing_fields.append("starts_at")
    if extracted.provider is None:
        extracted.missing_fields.append("provider")
        extracted.provider = "Unknown provider"
    return extracted


def is_promotion(subject: str, body: str) -> bool:
    """Marketing mail mentions a trip date without being a confirmation."""
    subject_lower = subject.lower()
    if any(word in subject_lower for word in _CONFIRMED_SUBJECT):
        return False
    text = f"{subject}\n{body}".lower()
    if "pnr number" in text and "departure flight" in text:
        return False
    if "total price" in text and "check-in" in text:
        return False
    if "room type" in text and "check in" in text and "booking id" in text:
        return False
    return any(phrase in text for phrase in _PROMO_PHRASES)


def _category_from_text(text: str) -> BookingCategory:
    lowered = text.lower()
    has_flight_number = _FLIGHT_NUMBER.search(text) is not None
    if has_flight_number and any(word in lowered for word in ("flight", "depart", "airline", "boarding", "arrive")):
        return BookingCategory.flight
    if any(word in lowered for word in ("boarding pass", "e-ticket", "eticket")):
        return BookingCategory.flight
    rules = (
        (("hotel", "hostel", "apartment", "check-in", "check-out", "airbnb"), BookingCategory.accommodation),
        (("train", "rail"), BookingCategory.train),
        (("bus", "flixbus"), BookingCategory.bus),
        (("car rental", "rental car"), BookingCategory.car_rental),
        (("transfer",), BookingCategory.transfer),
        (("cruise",), BookingCategory.cruise),
        (("insurance",), BookingCategory.insurance),
        (("restaurant", "dinner reservation"), BookingCategory.restaurant),
        (("tour", "activity", "ticket"), BookingCategory.activity),
    )
    for words, category in rules:
        if any(word in lowered for word in words):
            return category
    return BookingCategory.other


def _structured_details(text: str, extracted: ExtractedBooking) -> dict:
    category = extracted.category
    details: dict = {}
    people = _people(text)
    if category == BookingCategory.flight:
        details.update(_flight_details(text, extracted, people))
    elif category == BookingCategory.accommodation:
        details.update(_stay_details(text, extracted, people))
    elif category == BookingCategory.activity:
        details.update(_activity_details(text, extracted, people))
    elif category in (BookingCategory.train, BookingCategory.bus):
        details.update(_ground_details(text, extracted, people, category))
    elif category == BookingCategory.car_rental:
        details.update(_rental_details(text))
    elif category == BookingCategory.transfer:
        details["pickup_location"] = _labeled(text, ("pick-up", "pickup"))
        details["dropoff_location"] = _labeled(text, ("drop-off", "dropoff"))
        details["pickup_time"] = _clock_after(text, ("pick-up", "pickup"))
        details["passengers"] = people
    elif category == BookingCategory.cruise:
        details["ship"] = _labeled(text, ("ship", "vessel"))
        details["embarkation"] = _labeled(text, ("embarkation", "departs from", "from"))
        details["disembarkation"] = _labeled(text, ("disembarkation", "arrives at"))
        details["cabin"] = _labeled(text, ("cabin", "stateroom"))
        details["passengers"] = people
    elif category == BookingCategory.insurance:
        details["policy_number"] = _labeled(text, ("policy number", "policy"))
        details["coverage"] = _labeled(text, ("coverage", "plan"))
    elif category == BookingCategory.restaurant:
        details["venue"] = extracted.location_label or _labeled(text, ("restaurant", "venue"))
        details["party_size"] = _labeled(text, ("party size", "guests", "covers"))
        details["reservation_time"] = _clock_after(text, ("reservation", "time"))
    title = _title_for(category, details, extracted)
    if title:
        details["title"] = title
    return normalize_details(category.value, details)


def _flight_details(text: str, extracted: ExtractedBooking, people: str | None) -> dict:
    details: dict = {"passengers": people, "airline": _airline(text) or _labeled(text, ("airline", "carrier"))}
    flight = _FLIGHT_NUMBER.search(text)
    if flight:
        details["flight_number"] = f"{flight.group(1).upper()}{flight.group(2)}"
    origin, origin_code, destination, destination_code = _route_parts(text)
    details["origin"] = origin
    details["origin_code"] = origin_code
    details["destination"] = destination
    details["destination_code"] = destination_code
    details["departure_time"] = _clock_after(text, ("departure", "departs", "depart"))
    details["arrival_time"] = _clock_after(text, ("arrival", "arrives", "arrive"))
    details["departure_terminal"] = _labeled(text, ("departure terminal", "departing terminal"))
    details["arrival_terminal"] = _labeled(text, ("arrival terminal", "arriving terminal"))
    details["cabin"] = _cabin(text)
    return details


def _stay_details(text: str, extracted: ExtractedBooking, people: str | None) -> dict:
    subject_place = _place_from_subject(text.split("\n", 1)[0])
    property_name = (
        _labeled(text, ("property name", "hotel name", "property", "hostel"))
        or subject_place
        or extracted.location_label
    )
    if property_name and extracted.provider and property_name.lower() == extracted.provider.lower():
        property_name = extracted.location_label
    lowered = text.lower()
    stay_kind = None
    for kind in ("hostel", "apartment", "vacation rental", "hotel"):
        if kind in lowered:
            stay_kind = "apartment" if kind == "vacation rental" else kind
            break
    if stay_kind is None and "airbnb" in lowered:
        stay_kind = "apartment"
    return {
        "property_name": property_name,
        "stay_kind": stay_kind,
        "address": _labeled(text, ("address",)),
        "check_in_time": _stay_clock(text, "in"),
        "check_out_time": _stay_clock(text, "out"),
        "guests": people or _labeled(text, ("guest name", "guests", "guest")),
        "room": _labeled(text, ("room type", "room")),
        "reservation_pin": _pin(text),
    }


def _activity_details(text: str, extracted: ExtractedBooking, people: str | None) -> dict:
    return {
        "experience_name": _labeled(text, ("tour", "experience", "activity")) or extracted.location_label,
        "meeting_point": _labeled(text, ("meeting point", "meeting place", "venue")),
        "start_time": _clock_after(text, ("start time", "starts", "meeting time")),
        "duration": _labeled(text, ("duration",)),
        "participants": people or _labeled(text, ("participants", "guests")),
        "operator": _labeled(text, ("operator", "guide")),
    }


def _ground_details(text: str, extracted: ExtractedBooking, people: str | None, category: BookingCategory) -> dict:
    origin, origin_code, destination, destination_code = _route_parts(text)
    details = {
        "operator": _labeled(text, ("operator", "carrier")),
        "origin": origin,
        "destination": destination,
        "departure_time": _clock_after(text, ("departure", "departs")),
        "arrival_time": _clock_after(text, ("arrival", "arrives")),
        "seat": _labeled(text, ("seat",)),
        "passengers": people,
    }
    if category == BookingCategory.train:
        number = re.search(r"\b(?:train|service)\s*[:#]?\s*([A-Z]{0,3}\s?\d{2,5})\b", text, re.IGNORECASE)
        details["train_number"] = number.group(1).upper().replace(" ", "") if number else None
        details["carriage"] = _labeled(text, ("carriage", "coach", "car"))
    del origin_code, destination_code
    return details


def _rental_details(text: str) -> dict:
    return {
        "vehicle": _labeled(text, ("vehicle", "car")),
        "pickup_location": _labeled(text, ("pick-up location", "pickup location", "pick-up", "pickup")),
        "dropoff_location": _labeled(text, ("drop-off location", "dropoff location", "drop-off", "dropoff")),
        "pickup_time": _clock_after(text, ("pick-up", "pickup")),
        "dropoff_time": _clock_after(text, ("drop-off", "dropoff", "return")),
    }


def _title_for(category: BookingCategory, details: dict, extracted: ExtractedBooking) -> str | None:
    if category == BookingCategory.flight:
        ends = [details.get("flight_number"), _route_label(details)]
        return " · ".join(part for part in ends if part) or extracted.provider
    if category == BookingCategory.accommodation:
        return details.get("property_name") or extracted.provider
    if category == BookingCategory.activity:
        return details.get("experience_name") or extracted.provider
    if category in (BookingCategory.train, BookingCategory.bus, BookingCategory.transfer, BookingCategory.cruise):
        route = _route_label(details)
        return route or details.get("ship") or extracted.location_label or extracted.provider
    if category == BookingCategory.car_rental:
        return details.get("vehicle") or extracted.provider
    if category == BookingCategory.restaurant:
        return details.get("venue") or extracted.provider
    return extracted.location_label or extracted.provider


def _route_parts(text: str) -> tuple[str | None, str | None, str | None, str | None]:
    coded = _CODED_ROUTE.search(text)
    if coded:
        return (
            _clean_place(coded.group(1)),
            coded.group(2),
            _clean_place(coded.group(3)),
            coded.group(4),
        )
    route = _ROUTE.search(text)
    if not route:
        return None, None, None, None
    return (
        _clean_place(route.group(1)),
        route.group(2),
        _clean_place(route.group(3)),
        route.group(4),
    )


def _labeled(text: str, labels: tuple[str, ...]) -> str | None:
    ordered = tuple(sorted(labels, key=len, reverse=True))
    pattern = "|".join(re.escape(label) for label in ordered)
    match = re.search(rf"(?:{pattern})\s*[:\-]\s*([^\n]+)", text, re.IGNORECASE)
    if not match:
        return None
    value = re.split(r"\s{2,}", match.group(1).strip())[0].strip(" .")
    if not value or len(value) > 160:
        return None
    return value


def _people(text: str) -> str | None:
    found: list[str] = []
    for match in re.finditer(
        r"(?i:passenger|travell?er|guest name|guest)\s*(?:\d+\s*)?[:\-]\s*([A-Z][A-Za-z .'-]{1,60})",
        text,
    ):
        name = match.group(1).strip(" .")
        if name.lower() in {"name", "details", "information"} or "cancel" in name.lower():
            continue
        if name not in found:
            found.append(name)
        if len(found) == 6:
            break
    if not found:
        return None
    return ", ".join(found)


def _pin(text: str) -> str | None:
    match = re.search(r"\bPIN(?:\s+code)?\s*[:#]?\s*(\d{4,8})\b", text, re.IGNORECASE)
    return match.group(1) if match else None


def _airline(text: str) -> str | None:
    lowered = text.lower()
    for name in _AIRLINES:
        if name.lower() in lowered:
            return name
    return None


def _cabin(text: str) -> str | None:
    lowered = text.lower()
    for cabin in _CABINS:
        if cabin in lowered:
            return cabin
    return None


def _clock_after(text: str, labels: tuple[str, ...]) -> str | None:
    ordered = tuple(sorted(labels, key=len, reverse=True))
    pattern = "|".join(re.escape(label) for label in ordered)
    match = re.search(rf"(?:{pattern})[^\n]{{0,40}}?(\d{{1,2}}:\d{{2}})", text, re.IGNORECASE)
    if not match:
        return None
    return _clock(match.group(1))


def _stay_clock(text: str, which: str) -> str | None:
    if which == "in":
        match = re.search(r"check[- ]?in[\s\S]{0,80}?(?:from|after|at)\s+(\d{1,2}:\d{2})", text, re.IGNORECASE)
    else:
        match = re.search(
            r"check[- ]?out[\s\S]{0,80}?(?:until|before|by|at)\s+(\d{1,2}:\d{2})",
            text,
            re.IGNORECASE,
        )
    return _clock(match.group(1)) if match else None


def _clock(value: str) -> str | None:
    hour, minute = (int(part) for part in value.split(":"))
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _apply_clocks(extracted: ExtractedBooking) -> None:
    details = extracted.details
    if extracted.category == BookingCategory.flight:
        extracted.starts_at = _with_clock(extracted.starts_at, details.get("departure_time"))
        extracted.ends_at = _with_clock(extracted.ends_at, details.get("arrival_time"))
    elif extracted.category == BookingCategory.accommodation:
        extracted.starts_at = _with_clock(extracted.starts_at, details.get("check_in_time"))
        extracted.ends_at = _with_clock(extracted.ends_at, details.get("check_out_time"))
    elif extracted.category in (BookingCategory.train, BookingCategory.bus):
        extracted.starts_at = _with_clock(extracted.starts_at, details.get("departure_time"))
        extracted.ends_at = _with_clock(extracted.ends_at, details.get("arrival_time"))
    elif extracted.category == BookingCategory.activity:
        extracted.starts_at = _with_clock(extracted.starts_at, details.get("start_time"))


def _with_clock(moment: datetime | None, clock: str | None) -> datetime | None:
    if moment is None or not isinstance(clock, str) or moment.hour or moment.minute:
        return moment
    hour, minute = (int(part) for part in clock.split(":"))
    return moment.replace(hour=hour, minute=minute)


def _cancellation_policy(text: str) -> str | None:
    match = re.search(
        r"((?:free|non-refundable|partial)\s+cancellation[^\n.]{0,140}|cancel(?:lation)?\s+(?:for free|until)[^\n.]{0,140})",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    policy = re.sub(r"\s+", " ", match.group(1)).strip(" .")
    return policy[:240] or None


def _clean_place(value: str) -> str:
    cleaned = value.strip(" .,-")
    return re.sub(r"\s+(on|at|the)$", "", cleaned, flags=re.IGNORECASE)


def _route_label(details: dict) -> str | None:
    origin = details.get("origin")
    destination = details.get("destination")
    if origin and destination:
        return f"{origin} → {destination}"
    return origin or destination


def _provider_name(lowered: str) -> str | None:
    for label, needles in _KNOWN_PROVIDERS:
        if any(needle in lowered for needle in needles):
            return label
    return None


def _place_from_subject(subject: str) -> str | None:
    match = re.search(r"(?:stay at|reservation at|booking at|confirmed at|at)\s+(.+)", subject, re.IGNORECASE)
    if not match:
        return None
    place = re.split(r"\s+(?:is|has|on|from|–|-)\s+", match.group(1), maxsplit=1)[0].strip(" .")
    if len(place) < 3 or len(place) > 120:
        return None
    return place


def _travel_dates(text: str) -> tuple[datetime | None, datetime | None, list[datetime]]:
    labeled_start = None
    labeled_end = None
    for match in re.finditer(
        r"(check[- ]?in|check[- ]?out|departure|depart(?:s|ure)?|arrival|arrive[sd]?)"
        r"[\s:.\-–]*"
        r"(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?"
        r"(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})",
        text,
        re.IGNORECASE,
    ):
        parsed = _parse_date(match.group(2))
        if parsed is None:
            continue
        label = match.group(1).lower()
        if label.startswith("check-o") or label.startswith("check o") or label.startswith("arriv"):
            labeled_end = labeled_end or parsed
        else:
            labeled_start = labeled_start or parsed
    found: list[datetime] = []
    seen: set[str] = set()
    years = [int(item) for item in re.findall(r"\b(20\d{2})\b", text)]
    for raw in _DATE.findall(text):
        parsed_dates = [_parse_date(raw)]
        if re.fullmatch(rf"\d{{1,2}}\s*(?:{_MONTH})", raw.strip(), re.IGNORECASE):
            parsed_dates = [_parse_date(raw, year) for year in years] or parsed_dates
        for parsed in parsed_dates:
            if parsed is None:
                continue
            key = parsed.date().isoformat()
            if key in seen:
                continue
            seen.add(key)
            found.append(parsed)
            if len(found) == 12:
                return labeled_start, labeled_end, found
    return labeled_start, labeled_end, found


def _provider_from_subject(subject: str) -> str | None:
    match = re.search(r"(?:with|from|via)\s+([A-Z][\w&.' -]{2,40})", subject)
    if match:
        return match.group(1).strip()
    return None


def _parse_date(value: str, year: int | None = None) -> datetime | None:
    raw = value.strip()
    compact = re.match(rf"(\d{{1,2}})({_MONTH})(\d{{4}})", raw, re.IGNORECASE)
    if compact:
        raw = f"{compact.group(1)} {compact.group(2)} {compact.group(3)}"
    elif year and re.fullmatch(rf"\d{{1,2}}\s*(?:{_MONTH})", raw, re.IGNORECASE):
        raw = f"{raw} {year}"
    dayfirst = bool(re.match(r"\d{1,2}[./]\d{1,2}[./]", raw))
    try:
        parsed = date_parser.parse(raw, fuzzy=False, dayfirst=dayfirst)
    except (ValueError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
