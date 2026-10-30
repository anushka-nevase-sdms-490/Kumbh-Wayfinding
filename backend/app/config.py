from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Production refuses unsafe settings at start; a typo (e.g. "prod") fails too.
    setu_env: Literal["development", "production"] = "development"
    database_url: str = "postgresql+psycopg2://setu:setu@localhost:5432/setu"
    # Set USE_SQLITE=1 for local run without Docker/Postgres
    use_sqlite: bool = True
    sqlite_path: str = "setu_local.db"
    # Server secret (visitor-report fingerprints). Set SECRET_KEY in production.
    secret_key: str = DEFAULT_SECRET
    # Comma-separated origins allowed to call the API from another site.
    cors_origins: str = "*"
    pack_dir: str = "data/packs"
    # Saved OpenStreetMap answers (scripts/import_osm.py); empty = backend/data/osm.
    osm_dir: str = ""
    # "manual": new places, lanes, imports and trust changes wait until an
    # admin publishes them; closures, reopenings and rejections still reach
    # phones at once. "auto": every change is live. Empty: manual in
    # production, auto in development (docs/ADMIN_WORKFLOW.md).
    publish_mode: Literal["", "auto", "manual"] = ""
    # Lost-person case handling stores personal data (children too): off in
    # production until an authority approves it ("1" turns it on). Empty: on
    # in development, off in production.
    cases_enabled: Literal["", "0", "1"] = ""
    # Days a closed case (and its history) is kept before it is deleted.
    case_retention_days: int = 30
    # Days a resolved SOS alert (with its location) is kept.
    sos_retention_days: int = 7


def cases_on(s: "Settings") -> bool:
    return (s.cases_enabled or ("0" if s.setu_env == "production" else "1")) == "1"


def publishing_manual(s: "Settings") -> bool:
    return (s.publish_mode or ("manual" if s.setu_env == "production" else "auto")) == "manual"


def production_problems(s: Settings) -> list[str]:
    """What makes these settings unsafe for a public server (empty = fine)."""
    if s.setu_env != "production":
        return []
    problems = []
    if s.secret_key == DEFAULT_SECRET or len(s.secret_key) < 32:
        problems.append("SECRET_KEY must be set to a random value of at least 32 characters")
    if "*" in [o.strip() for o in s.cors_origins.split(",")]:
        problems.append("CORS_ORIGINS must list the site's own origin(s), not *")
    if s.use_sqlite:
        problems.append("USE_SQLITE must be 0 (use Postgres via DATABASE_URL)")
    return problems


settings = Settings()
