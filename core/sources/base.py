from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DownloadResult:
    local_path: Path
    name: str
    provider: str
    metadata: dict = field(default_factory=dict)


class SourceProvider(ABC):
    """Abstract base for external dataset source providers."""

    name: str = ""

    @abstractmethod
    def is_available(self) -> tuple[bool, str]:
        """Return (available, reason). reason is empty string when available."""

    @abstractmethod
    def download(self, identifier: str, dest_dir: Path, **kwargs) -> DownloadResult:
        """Download a dataset identified by `identifier` into `dest_dir`."""

    def require_available(self) -> None:
        ok, reason = self.is_available()
        if not ok:
            raise RuntimeError(f"{self.name} integration unavailable: {reason}")
