from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.permissions import request_is_write
from app.api.v1.router import router
from app.core.config import get_settings
from app.core.database import get_engine
from app.core.errors import AppError
from app.models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_production_safe()
    if settings.database_url.startswith("sqlite") and os.environ.get("TRAVEL_OS_AUTO_CREATE", "1") != "0":
        Base.metadata.create_all(get_engine())
    yield


class WriteIntentMiddleware:
    """Tell the permission helper whether this request reads or changes data."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "http":
            token = request_is_write.set(scope["method"] not in ("GET", "HEAD", "OPTIONS"))
            try:
                await self.app(scope, receive, send)
            finally:
                request_is_write.reset(token)
        else:
            await self.app(scope, receive, send)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Travel OS", version="0.1.0", lifespan=lifespan)
    app.add_middleware(WriteIntentMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    app.include_router(router, prefix="/api/v1")
    return app


app = create_app()
