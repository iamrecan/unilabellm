from __future__ import annotations

import logging
import tarfile
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import httpx

from core.sources.base import DownloadResult, SourceProvider

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2"}


class URLProvider(SourceProvider):
    """
    Download a YOLO dataset from any direct URL pointing to a zip/tar archive.

    Usage:
        provider.download("https://example.com/dataset.zip", dest_dir)
        provider.download("https://example.com/dataset.zip", dest_dir, name="my_ds")
    """

    name = "URL"

    def is_available(self) -> tuple[bool, str]:
        return True, ""

    def download(
        self,
        identifier: str,
        dest_dir: Path,
        name: str | None = None,
        timeout: float = 300.0,
        **kwargs,
    ) -> DownloadResult:
        """
        identifier: a direct HTTP/HTTPS URL to a zip or tar archive.
        name: optional dataset name (defaults to the archive filename stem).
        """
        url = identifier
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"URL must start with http:// or https://, got: '{url}'")

        archive_name = Path(parsed.path).name
        if not archive_name:
            raise ValueError(f"Cannot determine filename from URL: '{url}'")

        dest_dir.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = Path(tmp) / archive_name
            _download_file(url, archive_path, timeout=timeout)

            ds_name = name or _stem(archive_name)
            extract_root = dest_dir / ds_name
            extract_root.mkdir(exist_ok=True)

            _extract(archive_path, extract_root)

        final_path = _unwrap_single_folder(extract_root)
        logger.info("URL dataset ready at '%s'", final_path)

        return DownloadResult(
            local_path=final_path,
            name=ds_name,
            provider="url",
            metadata={"url": url},
        )


def _download_file(url: str, dest: Path, timeout: float) -> None:
    logger.info("Downloading %s …", url)
    with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1024 * 256):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    logger.debug("  %.1f%%", pct)
    logger.info("Downloaded %d bytes → %s", downloaded, dest)


def _extract(archive: Path, dest: Path) -> None:
    name = archive.name.lower()
    if name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(dest)
    elif any(name.endswith(ext) for ext in (".tar.gz", ".tgz", ".tar.bz2", ".tar")):
        with tarfile.open(archive) as tf:
            tf.extractall(dest)
    else:
        raise ValueError(
            f"Unsupported archive format: '{archive.name}'. "
            f"Supported: {SUPPORTED_EXTENSIONS}"
        )


def _stem(filename: str) -> str:
    """Remove all archive extensions: 'ds.tar.gz' → 'ds'."""
    p = Path(filename)
    while p.suffix in {".gz", ".bz2", ".zip", ".tar", ".tgz"}:
        p = p.with_suffix("")
    return p.name or filename


def _unwrap_single_folder(path: Path) -> Path:
    children = [c for c in path.iterdir() if not c.name.startswith(".")]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return path
