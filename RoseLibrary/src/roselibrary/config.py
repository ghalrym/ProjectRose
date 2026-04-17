from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ROSE_", env_file=".env")

    ollama_base_url: str = "http://localhost:11434"
    ollama_embedding_model: str = "snowflake-arctic-embed2"
    host: str = "0.0.0.0"
    port: int = 8000
    data_dir: str = "./data"
    observability_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
