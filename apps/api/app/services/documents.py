from datetime import date, timedelta


def document_reminders(documents: list, today: date) -> list[dict]:
    soon = today + timedelta(days=30)
    notes = []
    for document in documents:
        expires = document.expires_on
        if expires is None or expires < today or expires > soon:
            continue
        notes.append(
            {
                "kind": "document_expiry",
                "title": "Document date coming up",
                "body": f"{document.title} is dated {expires.isoformat()} in the record you saved.",
                "when": expires,
            }
        )
    return notes
