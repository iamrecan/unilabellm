from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    openrouter_api_key: str = ""
    workspace_path: Path = Path("./workspace")
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    log_level: str = "INFO"
    llm_model: str = "google/gemma-4-26b-a4b-it:free"
    llm_max_retries: int = 5
    llm_timeout: float = 120.0
    # External source credentials (optional)
    kaggle_username: str = ""
    kaggle_key: str = ""
    roboflow_api_key: str = ""

    @property
    def sessions_path(self) -> Path:
        return self.workspace_path / "sessions"

    @property
    def sources_path(self) -> Path:
        return self.workspace_path / "sources"

    @property
    def exports_path(self) -> Path:
        return self.workspace_path / "exports"

    def ensure_workspace(self) -> None:
        for p in [self.sessions_path, self.sources_path, self.exports_path]:
            p.mkdir(parents=True, exist_ok=True)


settings = Settings()
