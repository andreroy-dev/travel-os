"""Search links that open a provider's own site with the city and dates filled in.

PRD 2.3: Travel OS hands the traveller to the provider; the booking happens there and
is imported afterwards. These links carry no price or availability, so nothing here
can be mistaken for a listing. Affiliate IDs, when configured, are appended (PRD 2.6).
"""

from datetime import date
from urllib.parse import quote, urlencode

from app.core.config import get_settings

DISCLOSURE = "Opens the provider's site. Travel OS doesn't make the booking and doesn't see prices."


def stay_search_links(city: str, check_in: date, check_out: date, guests: int = 1) -> list[dict]:
    city = city.strip()
    settings = get_settings()
    booking_params = {
        "ss": city,
        "checkin": check_in.isoformat(),
        "checkout": check_out.isoformat(),
        "group_adults": guests,
        "no_rooms": 1,
    }
    if settings.booking_affiliate_id:
        booking_params["aid"] = settings.booking_affiliate_id
    airbnb = {"checkin": check_in.isoformat(), "checkout": check_out.isoformat(), "adults": guests}
    return [
        {
            "provider": "Booking.com",
            "kind": "hotels and apartments",
            "url": f"https://www.booking.com/searchresults.html?{urlencode(booking_params)}",
        },
        {
            "provider": "Airbnb",
            "kind": "homes",
            "url": f"https://www.airbnb.com/s/{quote(city)}/homes?{urlencode(airbnb)}",
        },
        {
            "provider": "Google Hotels",
            "kind": "compare across sites",
            "url": "https://www.google.com/travel/search?"
            + urlencode({"q": f"hotels in {city} {check_in.isoformat()} to {check_out.isoformat()}"}),
        },
    ]
