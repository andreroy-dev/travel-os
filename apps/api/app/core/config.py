from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Pasted dashboard values often carry a stray space or newline; Google then rejects the client ID.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", str_strip_whitespace=True)

    environment: str = "development"
    database_url: str = "sqlite:///./travelos.db"
    jwt_secret: str = "dev-only-change-me"
    jwt_ttl_days: int = 30
    token_encryption_key: str | None = None
    cors_origins: str = "*"

    supabase_jwt_secret: str | None = None
    supabase_url: str | None = None
    # Dev email-only sign-in. Turned off automatically in production.
    dev_login_enabled: bool = True
    # Forwarding import. Both must be set before the app shows a forwarding address:
    # the domain must receive mail through an inbound provider that posts to
    # /api/v1/emails/inbound with the X-Inbound-Secret header.
    # Affiliate IDs for provider search links (optional; disclosed in the app).
    booking_affiliate_id: str | None = None
    inbound_email_domain: str | None = None
    inbound_email_secret: str | None = None

    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8000/api/v1/integrations/gmail/callback"

    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    ai_daily_request_limit: int = 30

    upload_dir: str = "./var/uploads"
    # Private Supabase Storage bucket for wallet files. Set both to store files off-server.
    supabase_service_key: str | None = None
    storage_bucket: str = "documents"
    gmail_sync_limit: int = 60

    def cors_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def ensure_production_safe(self) -> None:
        # Hosts like Render wipe the local disk on every deploy, so a SQLite file would lose all data.
        if self.environment == "production" and self.database_url.startswith("sqlite"):
            raise RuntimeError("Set DATABASE_URL to the Postgres connection string before running in production.")
        if self.environment == "production" and self.jwt_secret == "dev-only-change-me":
            raise RuntimeError("Set JWT_SECRET before running in production.")
        if self.environment == "production" and not (self.supabase_url or self.supabase_jwt_secret):
            raise RuntimeError("Set SUPABASE_URL (or SUPABASE_JWT_SECRET) before running in production.")
        if self.environment == "production" and not (self.supabase_url and self.supabase_service_key):
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_KEY so uploads survive deploys.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
