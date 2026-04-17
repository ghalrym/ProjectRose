from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ROSE_", env_file=".env")

    host: str = "0.0.0.0"
    port: int = 8020
    data_dir: str = "./data"
    retention_days: int = 14
    max_payload_bytes: int = 65536


@lru_cache
def get_settings() -> Settings:
    return Settings()
