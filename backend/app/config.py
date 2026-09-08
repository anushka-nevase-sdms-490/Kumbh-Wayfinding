from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://setu:setu@localhost:5432/setu"
    # Set USE_SQLITE=1 for local run without Docker/Postgres
    use_sqlite: bool = True
    sqlite_path: str = "setu_local.db"
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "setu"
    s3_secret_key: str = "setusecret"
    s3_bucket: str = "setu-audits"
    jwt_secret: str = "change-me-in-production"
    cors_origins: str = "*"
    pack_dir: str = "data/packs"


settings = Settings()
