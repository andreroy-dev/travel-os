from fastapi import APIRouter

from app.api.v1.routes import account, assistant, bookings, dashboard, inbox, inventory, itinerary, travel

router = APIRouter()
router.include_router(account.router, tags=["account"])
router.include_router(travel.router, tags=["travel"])
router.include_router(bookings.router, tags=["bookings"])
router.include_router(itinerary.router, tags=["itinerary"])
router.include_router(inbox.router, tags=["inbox"])
router.include_router(dashboard.router, tags=["dashboard"])
router.include_router(assistant.router, tags=["assistant"])
router.include_router(inventory.router, tags=["inventory"])
