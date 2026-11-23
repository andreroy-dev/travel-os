"""Category fields stored on Booking.details.

Common facts (provider, confirmation, dates, price, status, cancellation)
live on the booking row. These keys are the extra facts for one category.
A value is stored only when the email actually contains it.
"""

CATEGORY_FIELDS: dict[str, tuple[tuple[str, str], ...]] = {
    "flight": (
        ("airline", "Airline"),
        ("flight_number", "Flight number"),
        ("origin", "From"),
        ("origin_code", "From code"),
        ("destination", "To"),
        ("destination_code", "To code"),
        ("departure_time", "Departs"),
        ("arrival_time", "Arrives"),
        ("departure_terminal", "Departure terminal"),
        ("arrival_terminal", "Arrival terminal"),
        ("cabin", "Cabin"),
        ("passengers", "Passengers"),
    ),
    "accommodation": (
        ("property_name", "Property"),
        ("stay_kind", "Type"),
        ("address", "Address"),
        ("check_in_time", "Check-in time"),
        ("check_out_time", "Check-out time"),
        ("guests", "Guests"),
        ("room", "Room"),
        ("reservation_pin", "PIN"),
    ),
    "activity": (
        ("experience_name", "Experience"),
        ("meeting_point", "Meeting point"),
        ("start_time", "Starts"),
        ("duration", "Duration"),
        ("participants", "Participants"),
        ("operator", "Operator"),
    ),
    "train": (
        ("operator", "Operator"),
        ("train_number", "Train"),
        ("origin", "From"),
        ("destination", "To"),
        ("departure_time", "Departs"),
        ("arrival_time", "Arrives"),
        ("carriage", "Carriage"),
        ("seat", "Seat"),
        ("passengers", "Passengers"),
    ),
    "bus": (
        ("operator", "Operator"),
        ("origin", "From"),
        ("destination", "To"),
        ("departure_time", "Departs"),
        ("arrival_time", "Arrives"),
        ("seat", "Seat"),
        ("passengers", "Passengers"),
    ),
    "car_rental": (
        ("vehicle", "Vehicle"),
        ("pickup_location", "Pick-up"),
        ("dropoff_location", "Drop-off"),
        ("pickup_time", "Pick-up time"),
        ("dropoff_time", "Drop-off time"),
    ),
    "transfer": (
        ("pickup_location", "Pick-up"),
        ("dropoff_location", "Drop-off"),
        ("pickup_time", "Pick-up time"),
        ("passengers", "Passengers"),
    ),
    "cruise": (
        ("ship", "Ship"),
        ("embarkation", "Embarks"),
        ("disembarkation", "Disembarks"),
        ("cabin", "Cabin"),
        ("passengers", "Passengers"),
    ),
    "insurance": (
        ("policy_number", "Policy"),
        ("coverage", "Coverage"),
    ),
    "restaurant": (
        ("venue", "Venue"),
        ("party_size", "Party size"),
        ("reservation_time", "Time"),
    ),
    "other": (("title", "Title"),),
}

CATEGORY_LABELS = {
    "flight": "Flights",
    "accommodation": "Accommodation",
    "activity": "Tours and guides",
    "train": "Trains",
    "bus": "Buses",
    "car_rental": "Car rentals",
    "transfer": "Transfers",
    "cruise": "Cruises",
    "insurance": "Insurance",
    "restaurant": "Restaurants",
    "other": "Other",
}


def field_catalog() -> list[dict]:
    return [
        {
            "category": category,
            "label": CATEGORY_LABELS[category],
            "fields": [{"key": key, "label": label} for key, label in fields],
        }
        for category, fields in CATEGORY_FIELDS.items()
    ]


def normalize_details(category: str, raw: dict) -> dict:
    allowed = {key for key, _label in CATEGORY_FIELDS.get(category, CATEGORY_FIELDS["other"])}
    allowed.add("title")
    cleaned: dict = {"schema_version": 1}
    segments = _clean_segments(raw.get("segments"))
    if segments:
        cleaned["segments"] = segments
    for key, value in raw.items():
        if key in {"segments", "schema_version"} or key not in allowed or value is None:
            continue
        if isinstance(value, list):
            text = ", ".join(str(item).strip() for item in value if str(item).strip())
        else:
            text = str(value).strip()
        if text:
            cleaned[key] = text[:240]
    return cleaned


def _clean_segments(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    cleaned: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        segment = {
            key: str(raw).strip()[:80]
            for key, raw in item.items()
            if raw and str(raw).strip()
        }
        if segment:
            cleaned.append(segment)
    return cleaned[:8]
