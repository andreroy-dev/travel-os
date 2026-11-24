"""Count stay days from dates the traveller logged.

The 90/180 figure is the arithmetic rule they selected. It is not a lookup of
their nationality and it is not an entry decision.
"""

from datetime import date, timedelta

DISCLAIMER = (
    "This counts days in the log you entered. It is not an entry decision "
    "and does not replace official immigration advice."
)
SCHENGEN_LIMIT = 90
SCHENGEN_WINDOW = 180


def presence_days(spans: list[tuple[date, date | None]], start: date, end: date) -> int:
    """Inclusive days present. Overlapping spans count once."""
    present: set[date] = set()
    for entered_on, exited_on in spans:
        span_end = exited_on or end
        cursor = entered_on if entered_on > start else start
        last = span_end if span_end < end else end
        while cursor <= last:
            present.add(cursor)
            cursor += timedelta(days=1)
    return len(present)


def count_stay(
    rule: str,
    spans: list[tuple[date, date | None]],
    on: date,
    allowed_days: int | None,
) -> dict:
    if rule == "schengen_90_180":
        window_start = on - timedelta(days=SCHENGEN_WINDOW - 1)
        used = presence_days(spans, window_start, on)
        limit = SCHENGEN_LIMIT
    else:
        window_start = None
        used = presence_days(spans, date.min, on) if spans else 0
        limit = allowed_days if allowed_days is not None else 0
    remaining = limit - used
    return {
        "used_days": used,
        "limit_days": limit,
        "remaining_days": remaining,
        "over_by": max(0, -remaining),
        "window_start": window_start.isoformat() if window_start else None,
        "as_of": on.isoformat(),
        "counting": "inclusive",
        "disclaimer": DISCLAIMER,
    }


def stay_reminders(logs: list[dict], on: date) -> list[dict]:
    notes = []
    for log in logs:
        count = log["count"]
        remaining = count["remaining_days"]
        if 0 <= remaining <= 7:
            notes.append(
                {
                    "kind": "stay_days",
                    "title": "Stay days in your log",
                    "body": f"{log['label']}: {remaining} days left in the count you entered.",
                    "when": on,
                }
            )
        elif remaining < 0:
            notes.append(
                {
                    "kind": "stay_days_over",
                    "title": "Day count exceeded",
                    "body": f"{log['label']}: the log is {count['over_by']} days over the count you entered.",
                    "when": on,
                }
            )
    return notes
