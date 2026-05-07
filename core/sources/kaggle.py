from __future__ import annotations

import logging
import os
import shutil
import zipfile
from pathlib import Path

from core.sources.base import DownloadResult, SourceProvider

logger = logging.getLogger(__name__)


class KaggleProvider(SourceProvider):
    """
    Download YOLO datasets from Kaggle.

    Credentials: set KAGGLE_USERNAME and KAGGLE_KEY env vars,
    or place ~/.kaggle/kaggle.json with {"username": "...", "key": "..."}.

    Usage:
        provider.download("owner/dataset-slug", dest_dir)
        provider.download("owner/dataset-slug/path/inside/zip", dest_dir)
    """

    name = "Kaggle"

    def is_available(self) -> tuple[bool, str]:
        import importlib.util

        if importlib.util.find_spec("kaggle") is None:
            return False, "kaggle package not installed — run: pip install kaggle"
        # Check credentials exist without triggering auth
        from pathlib import Path as _Path

        has_env = bool(os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"))
        has_json = (_Path.home() / ".kaggle" / "kaggle.json").exists()
        if not (has_env or has_json):
            return (
                False,
                "Kaggle credentials not found. Place ~/.kaggle/kaggle.json "
                "or set KAGGLE_USERNAME + KAGGLE_KEY env vars.",
            )
        return True, ""

    def download(
        self,
        identifier: str,
        dest_dir: Path,
        unzip: bool = True,
        **kwargs,
    ) -> DownloadResult:
        """
        identifier format:  owner/dataset-slug
                       or:  owner/dataset-slug/subpath   (extract only a subdirectory)
        """
        self.require_available()
        try:
            import kaggle
        except SystemExit as e:
            raise RuntimeError(
                "Kaggle package failed to initialize. "
                "Ensure credentials are set (KAGGLE_USERNAME + KAGGLE_KEY or ~/.kaggle/kaggle.json)."
            ) from e

        parts = identifier.strip("/").split("/")
        if len(parts) < 2:
            raise ValueError(
                f"Kaggle identifier must be 'owner/dataset-slug', got: '{identifier}'"
            )
        owner, slug = parts[0], parts[1]
        subpath = "/".join(parts[2:]) if len(parts) > 2 else None
        dataset_ref = f"{owner}/{slug}"

        dest_dir.mkdir(parents=True, exist_ok=True)
        zip_dir = dest_dir / f"_kaggle_{slug}"
        zip_dir.mkdir(exist_ok=True)

        logger.info("Downloading Kaggle dataset '%s'…", dataset_ref)
        try:
            kaggle.api.authenticate()
            kaggle.api.dataset_download_files(
                dataset_ref,
                path=str(zip_dir),
                unzip=False,
                quiet=False,
            )
        except Exception as e:
            raise RuntimeError(f"Kaggle download failed for '{dataset_ref}': {e}") from e

        zip_files = list(zip_dir.glob("*.zip"))
        if not zip_files:
            raise RuntimeError(f"No zip file found after downloading '{dataset_ref}'")

        extract_root = dest_dir / slug
        extract_root.mkdir(exist_ok=True)

        with zipfile.ZipFile(zip_files[0]) as zf:
            if subpath:
                _extract_subpath(zf, subpath, extract_root)
            else:
                zf.extractall(extract_root)

        shutil.rmtree(zip_dir)

        # If extraction produced a single nested folder, unwrap it
        final_path = _unwrap_single_folder(extract_root)
        logger.info("Kaggle dataset ready at '%s'", final_path)

        return DownloadResult(
            local_path=final_path,
            name=slug,
            provider="kaggle",
            metadata={"dataset_ref": dataset_ref, "subpath": subpath},
        )


def _extract_subpath(zf: zipfile.ZipFile, subpath: str, dest: Path) -> None:
    prefix = subpath.rstrip("/") + "/"
    extracted = False
    for member in zf.namelist():
        if member.startswith(prefix):
            rel = member[len(prefix):]
            if not rel:
                continue
            target = dest / rel
            if member.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as dst:
                    dst.write(src.read())
            extracted = True
    if not extracted:
        raise ValueError(
            f"Subpath '{subpath}' not found in zip. "
            f"Available top-level entries: {_top_level_entries(zf)}"
        )


def _top_level_entries(zf: zipfile.ZipFile) -> list[str]:
    seen: set[str] = set()
    for name in zf.namelist():
        top = name.split("/")[0]
        seen.add(top)
    return sorted(seen)[:10]


def _unwrap_single_folder(path: Path) -> Path:
    children = [c for c in path.iterdir() if not c.name.startswith(".")]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return path
