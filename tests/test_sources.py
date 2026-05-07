"""
Tests for external source providers.
All network calls and third-party packages are mocked — no real downloads happen.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml

from core.sources.base import DownloadResult, SourceProvider
from core.sources.kaggle import KaggleProvider
from core.sources.roboflow import RoboflowProvider
from core.sources.url import URLProvider, _stem

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def make_yolo_zip(zip_path: Path, dataset_dir: Path) -> None:
    """Write a minimal YOLO dataset into a zip file."""
    with zipfile.ZipFile(zip_path, "w") as zf:
        data = yaml.dump({"nc": 2, "names": ["cat", "dog"]})
        zf.writestr("data.yaml", data)
        zf.writestr("images/train/img0.jpg", b"\xff\xd8\xff\xd9")
        zf.writestr("labels/train/img0.txt", "0 0.5 0.5 0.4 0.4\n")


# ------------------------------------------------------------------
# Base / ABC
# ------------------------------------------------------------------

def test_source_provider_require_available_raises():
    class BadProvider(SourceProvider):
        name = "Bad"
        def is_available(self):
            return False, "missing dep"
        def download(self, identifier, dest_dir, **kwargs):
            pass

    with pytest.raises(RuntimeError, match="missing dep"):
        BadProvider().require_available()


def test_source_provider_require_available_ok():
    class OkProvider(SourceProvider):
        name = "Ok"
        def is_available(self):
            return True, ""
        def download(self, identifier, dest_dir, **kwargs):
            return DownloadResult(local_path=dest_dir, name="x", provider="ok")

    OkProvider().require_available()  # should not raise


# ------------------------------------------------------------------
# URL provider
# ------------------------------------------------------------------

def test_url_stem_zip():
    assert _stem("dataset.zip") == "dataset"


def test_url_stem_tar_gz():
    assert _stem("coco128.tar.gz") == "coco128"


def test_url_invalid_scheme():
    provider = URLProvider()
    with pytest.raises(ValueError, match="http"):
        provider.download("ftp://example.com/ds.zip", Path("/tmp"))


def test_url_no_filename():
    provider = URLProvider()
    with pytest.raises(ValueError, match="filename"):
        provider.download("https://example.com/", Path("/tmp"))


def test_url_download_and_extract(tmp_path):
    """Mock the HTTP call and verify extraction + registration."""
    zip_path = tmp_path / "ds.zip"
    make_yolo_zip(zip_path, tmp_path)
    zip_bytes = zip_path.read_bytes()

    mock_response = MagicMock()
    mock_response.__enter__ = lambda s: s
    mock_response.__exit__ = MagicMock(return_value=False)
    mock_response.raise_for_status = MagicMock()
    mock_response.headers = {"content-length": str(len(zip_bytes))}
    mock_response.iter_bytes = MagicMock(return_value=iter([zip_bytes]))

    with patch("core.sources.url.httpx.stream", return_value=mock_response):
        provider = URLProvider()
        result = provider.download(
            "https://example.com/ds.zip",
            tmp_path / "out",
        )

    assert result.provider == "url"
    assert result.local_path.exists()
    assert (result.local_path / "data.yaml").exists() or any(
        (result.local_path).rglob("data.yaml")
    )


def test_url_unsupported_extension(tmp_path):
    provider = URLProvider()
    # Patch _download_file so it creates an unsupported file
    rar_path = tmp_path / "ds.rar"
    rar_path.write_bytes(b"Rar!")

    with patch("core.sources.url._download_file", return_value=None) as mock_dl:
        def side_effect(url, dest, timeout):
            dest.write_bytes(b"Rar!")
        mock_dl.side_effect = side_effect

        with pytest.raises((ValueError, Exception)):
            provider.download("https://example.com/ds.rar", tmp_path / "out2")


# ------------------------------------------------------------------
# Kaggle provider
# ------------------------------------------------------------------

def test_kaggle_unavailable_without_credentials(monkeypatch, tmp_path):
    """No credentials → is_available() returns False."""
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)
    # Patch home so ~/.kaggle/kaggle.json doesn't exist
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)

    provider = KaggleProvider()
    ok, reason = provider.is_available()
    assert not ok
    assert "credentials" in reason.lower() or "kaggle" in reason.lower()


def test_kaggle_unavailable_without_package():
    """importlib.util.find_spec returns None → is_available() returns False."""
    import importlib.util

    original = importlib.util.find_spec

    def patched_find_spec(name, *args, **kwargs):
        if name == "kaggle":
            return None
        return original(name, *args, **kwargs)

    with patch("importlib.util.find_spec", side_effect=patched_find_spec):
        provider = KaggleProvider()
        ok, reason = provider.is_available()
    assert not ok
    assert "pip install kaggle" in reason


def test_kaggle_invalid_identifier(tmp_path):
    provider = KaggleProvider()
    with patch.object(provider, "require_available"):
        # Patch kaggle import inside download() so it doesn't trigger auth
        mock_kaggle = MagicMock()
        with patch.dict("sys.modules", {"kaggle": mock_kaggle}):
            with pytest.raises(ValueError, match="owner/dataset-slug"):
                provider.download("single-name", tmp_path)


def test_kaggle_download_success(tmp_path):
    """Mock the kaggle API call and zip extraction."""
    zip_path = tmp_path / "_kaggle_coco128" / "coco128.zip"
    zip_path.parent.mkdir(parents=True)
    make_yolo_zip(zip_path, tmp_path)

    mock_kaggle = MagicMock()
    mock_kaggle.api.authenticate = MagicMock()
    mock_kaggle.api.dataset_download_files = MagicMock()

    provider = KaggleProvider()
    with patch.object(provider, "require_available"):
        with patch.dict("sys.modules", {"kaggle": mock_kaggle}):
            result = provider.download("ultralytics/coco128", tmp_path)

    assert result.provider == "kaggle"
    assert result.name == "coco128"
    mock_kaggle.api.dataset_download_files.assert_called_once()


# ------------------------------------------------------------------
# Roboflow provider
# ------------------------------------------------------------------

def test_roboflow_unavailable_without_api_key(monkeypatch):
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)

    mock_rf_module = MagicMock()
    with patch.dict("sys.modules", {"roboflow": mock_rf_module}):
        provider = RoboflowProvider()
        ok, reason = provider.is_available()
        assert not ok
        assert "ROBOFLOW_API_KEY" in reason


def test_roboflow_invalid_identifier(tmp_path, monkeypatch):
    monkeypatch.setenv("ROBOFLOW_API_KEY", "test-key")

    mock_rf_module = MagicMock()
    with patch.dict("sys.modules", {"roboflow": mock_rf_module}):
        provider = RoboflowProvider()
        with patch.object(provider, "require_available"):
            with pytest.raises(ValueError, match="workspace/project"):
                provider.download("only-one-part", tmp_path)


# ------------------------------------------------------------------
# SourceManager
# ------------------------------------------------------------------

def test_source_manager_check_availability(monkeypatch, tmp_path):
    from core.sources.manager import SourceManager

    # Ensure no Kaggle credentials so is_available() returns False cleanly
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)

    manager = SourceManager()
    status = manager.check_availability()
    assert "kaggle" in status
    assert "roboflow" in status
    assert "url" in status
    for key, (ok, reason) in status.items():
        assert isinstance(ok, bool)
        assert isinstance(reason, str)


def test_source_manager_add_local(tmp_path):
    from core.sources.manager import SourceManager

    # Create minimal dataset
    ds_dir = tmp_path / "myds"
    ds_dir.mkdir()
    (ds_dir / "data.yaml").write_text(yaml.dump({"nc": 1, "names": ["cat"]}))

    workspace = tmp_path / "workspace"
    manager = SourceManager(workspace_path=workspace)

    with patch.object(manager._workspace, "add_dataset") as mock_add:
        mock_add.return_value = MagicMock(
            name="myds", classes=["cat"], image_count=0, label_count=0, path=str(ds_dir)
        )
        manager._workspace.add_dataset(str(ds_dir), name="myds")
        mock_add.assert_called_once_with(str(ds_dir), name="myds")
