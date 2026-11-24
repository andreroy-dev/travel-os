"""Shares to settle from splits the traveller already saved."""

from decimal import Decimal

from app.services.money import money_text


def settle(payer_name: str, expenses: list[tuple[str, list[tuple[str, Decimal]]]]) -> dict:
    """Each expense is (currency, [(name, share)]).

    A balance is included only when the payer's name is one of the shares,
    which is how we know the logged person was part of that split.
    """
    payer = payer_name.strip().lower()
    totals: dict[tuple[str, str], Decimal] = {}
    skipped = 0
    for currency, shares in expenses:
        names = {name.strip().lower() for name, _amount in shares}
        if payer not in names:
            skipped += 1
            continue
        for name, amount in shares:
            if name.strip().lower() == payer:
                continue
            key = (name.strip(), currency.upper())
            totals[key] = totals.get(key, Decimal("0.00")) + amount
    return {
        "assumption": "These are the other people's shares on expenses that include your name. They count only if you paid the full amount you logged.",
        "balances": [
            {"name": name, "currency": currency, "amount": money_text(amount)}
            for (name, currency), amount in sorted(totals.items())
        ],
        "skipped": skipped,
    }
