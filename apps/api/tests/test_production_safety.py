import pytest

from app.core.config import Settings

READY = {
    "environment": "production",
    "database_url": "postgresql+psycopg://user:pass@db.example.com:5432/postgres",
    "jwt_secret": "a-long-random-production-secret-value-1234567890",
    "supabase_url": "https://x.supabase.co",
    "supabase_service_key": "service-key",
}


def make(**overrides) -> Settings:
    return Settings(_env_file=None, **{**READY, **overrides})


def test_production_with_every_setting_starts():
    make().ensure_production_safe()


def test_production_refuses_sqlite():
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        make(database_url="sqlite:///./travelos.db").ensure_production_safe()


def test_production_refuses_default_jwt_secret():
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        make(jwt_secret="dev-only-change-me").ensure_production_safe()


def test_production_refuses_missing_storage_key():
    with pytest.raises(RuntimeError, match="SUPABASE_SERVICE_KEY"):
        make(supabase_service_key=None).ensure_production_safe()


def test_development_allows_sqlite():
    make(environment="development", database_url="sqlite:///./travelos.db").ensure_production_safe()
