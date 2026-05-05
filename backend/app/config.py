from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
    )

    anthropic_api_key: str
    anthropic_model: str = "claude-sonnet-4-6"
    cors_origin: str = "http://localhost:3000"


settings = Settings()
