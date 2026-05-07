from __future__ import annotations

import logging
from pathlib import Path

from core.config import settings
from core.models import DatasetSource
from core.parser.yolo import parse_dataset
from core.sources.base import DownloadResult
from core.sources.kaggle import KaggleProvider
from core.sources.roboflow import RoboflowProvider
from core.sources.url import URLProvider
from core.workspace.manager import WorkspaceManager

logger = logging.getLogger(__name__)


class SourceManager:
    """
    High-level entry point for adding datasets from external sources.

    Downloads the dataset into workspace/sources/ and registers it
    in the WorkspaceManager index so it's immediately available for
    new harmonization sessions.
    """

    def __init__(self, workspace_path: Path | None = None) -> None:
        root = Path(workspace_path or settings.workspace_path)
        self._sources_dir = root / "sources"
        self._workspace = WorkspaceManager(workspace_path=root)
        self._providers = {
            "kaggle": KaggleProvider(),
            "roboflow": RoboflowProvider(),
            "url": URLProvider(),
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_from_kaggle(self, identifier: str, name: str | None = None) -> DatasetSource:
        """
        Download from Kaggle and register.

        identifier: 'owner/dataset-slug'  or  'owner/dataset-slug/subpath'
        """
        return self._download_and_register("kaggle", identifier, name=name)

    def add_from_roboflow(
        self,
        identifier: str,
        name: str | None = None,
        format: str = "yolov8",
    ) -> DatasetSource:
        """
        Download from Roboflow Universe and register.

        identifier: 'workspace/project'  or  'workspace/project/version'
        """
        return self._download_and_register(
            "roboflow", identifier, name=name, format=format
        )

    def add_from_url(self, url: str, name: str | None = None) -> DatasetSource:
        """Download a zip/tar from a direct URL and register."""
        return self._download_and_register("url", url, name=name)

    def check_availability(self) -> dict[str, tuple[bool, str]]:
        """Return availability status for each provider."""
        return {
            key: provider.is_available()
            for key, provider in self._providers.items()
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _download_and_register(
        self, provider_key: str, identifier: str, **kwargs
    ) -> DatasetSource:
        provider = self._providers[provider_key]
        self._sources_dir.mkdir(parents=True, exist_ok=True)

        result: DownloadResult = provider.download(
            identifier, self._sources_dir, **kwargs
        )

        name = kwargs.get("name") or result.name
        ds = parse_dataset(result.local_path, name=name)
        self._workspace.add_dataset(str(result.local_path), name=ds.name)

        logger.info(
            "Registered '%s' from %s: %d classes, %d images",
            ds.name,
            provider.name,
            len(ds.classes),
            ds.image_count,
        )
        return ds
