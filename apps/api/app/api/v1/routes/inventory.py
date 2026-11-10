from dataclasses import asdict

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.schemas import InventoryOut
from app.services.providers import ListingQuery, registry

router = APIRouter()


@router.get("/inventory/search", response_model=InventoryOut)
def search_inventory(user: CurrentUser, q: str = "", category: str = "accommodation") -> InventoryOut:
    _ = user
    found = registry.search(ListingQuery(category=category, query=q))
    listings = []
    for item in found:
        row = asdict(item)
        row["price_amount"] = None if item.price_amount is None else str(item.price_amount)
        row["last_updated"] = item.last_updated.isoformat()
        listings.append(row)
    return InventoryOut(providers=registry.names(), listings=listings)
