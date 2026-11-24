from urllib.parse import urlparse
from uuid import UUID

from dataclasses import asdict

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.ownership import owned
from app.core.errors import AppError
from app.models.entities import ListingClick, SavedListing, TravelSpace
from app.schemas import InventoryOut, ListingOpenOut, SavedListingIn, SavedListingOut
from app.services.providers import ListingQuery, registry

router = APIRouter()


def _check_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AppError(422, "A listing link must be an http or https address.")
    return url.strip()


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


@router.get("/saved-listings", response_model=list[SavedListingOut])
def list_saved_listings(user: CurrentUser, session: DbSession) -> list[SavedListing]:
    return list(
        session.scalars(select(SavedListing).where(SavedListing.user_id == user.id).order_by(SavedListing.created_at.desc())).all()
    )


@router.post("/saved-listings", response_model=SavedListingOut, status_code=201)
def create_saved_listing(payload: SavedListingIn, user: CurrentUser, session: DbSession) -> SavedListing:
    if payload.travel_space_id is not None:
        owned(session, TravelSpace, payload.travel_space_id, user.id)
    listing = SavedListing(
        user_id=user.id,
        travel_space_id=payload.travel_space_id,
        name=payload.name.strip(),
        category=payload.category,
        url=_check_url(payload.url),
        notes=payload.notes,
    )
    session.add(listing)
    session.commit()
    session.refresh(listing)
    return listing


@router.post("/saved-listings/{listing_id}/open", response_model=ListingOpenOut)
def open_saved_listing(listing_id: UUID, user: CurrentUser, session: DbSession) -> ListingOpenOut:
    listing = owned(session, SavedListing, listing_id, user.id)
    session.add(ListingClick(user_id=user.id, saved_listing_id=listing.id))
    session.commit()
    return ListingOpenOut(url=listing.url)


@router.delete("/saved-listings/{listing_id}", status_code=204)
def delete_saved_listing(listing_id: UUID, user: CurrentUser, session: DbSession) -> None:
    listing = owned(session, SavedListing, listing_id, user.id)
    session.delete(listing)
    session.commit()
