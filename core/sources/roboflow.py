from __future__ import annotations

import logging
from pathlib import Path

from core.sources.base import DownloadResult, SourceProvider

logger = logging.getLogger(__name__)


class RoboflowProvider(SourceProvider):
    """
    Download YOLO datasets from Roboflow Universe.

    Credentials: set ROBOFLOW_API_KEY env var.

    Usage:
        provider.download("workspace/project/version", dest_dir)
        # version can be a number ("3") or omit for latest
    """

    name = "Roboflow"

    def is_available(self) -> tuple[bool, str]:
        try:
            import roboflow  # noqa: F401
        except ImportError:
            return False, "roboflow package not installed — run: pip install roboflow"

        import os

        if not os.environ.get("ROBOFLOW_API_KEY", ""):
            return False, "ROBOFLOW_API_KEY environment variable not set"
        return True, ""

    def download(
        self,
        identifier: str,
        dest_dir: Path,
        format: str = "yolov8",
        **kwargs,
    ) -> DownloadResult:
        """
        identifier format:  workspace/project
                       or:  workspace/project/version   (version = integer string)

        format: Roboflow export format, default 'yolov8' (also accepts 'yolov5').
        """
        self.require_available()
        import os

        import roboflow

        parts = identifier.strip("/").split("/")
        if len(parts) < 2:
            raise ValueError(
                "Roboflow identifier must be 'workspace/project' or 'workspace/project/version'"
            )

        workspace = parts[0]
        project_name = parts[1]
        version_num = int(parts[2]) if len(parts) > 2 else None

        api_key = os.environ["ROBOFLOW_API_KEY"]
        dest_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "Downloading Roboflow project '%s/%s' (version=%s)…",
            workspace,
            project_name,
            version_num or "latest",
        )

        try:
            rf = roboflow.Roboflow(api_key=api_key)
            project = rf.workspace(workspace).project(project_name)
            version = project.version(version_num) if version_num else project.version(
                project.versions[-1].version
            )
            dataset = version.download(format, location=str(dest_dir), overwrite=True)
        except Exception as e:
            raise RuntimeError(
                f"Roboflow download failed for '{identifier}': {e}"
            ) from e

        local_path = Path(dataset.location)
        logger.info("Roboflow dataset ready at '%s'", local_path)

        return DownloadResult(
            local_path=local_path,
            name=f"{project_name}-{version_num or 'latest'}",
            provider="roboflow",
            metadata={
                "workspace": workspace,
                "project": project_name,
                "version": version_num,
                "format": format,
            },
        )
