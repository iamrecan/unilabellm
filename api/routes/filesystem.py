from __future__ import annotations

import logging
import mimetypes
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/filesystem", tags=["filesystem"])
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------

class DirEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    is_dataset: bool  # True when data.yaml / dataset.yaml found inside


class BrowseResponse(BaseModel):
    path: str
    parent: str | None
    entries: list[DirEntry]


class PickResponse(BaseModel):
    path: str | None   # None if user cancelled or native picker unavailable
    available: bool = True  # False → native picker couldn't open; UI should show browser fallback


# ------------------------------------------------------------------
# Native OS folder picker
# ------------------------------------------------------------------

def _open_native_picker(initial_dir: str) -> str | None:
    """Open a native OS folder picker dialog.
    Returns selected path, or None if user cancelled.
    Raises on any failure so the caller can return available=False.
    """
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.call("wm", "attributes", ".", "-topmost", True)
    folder = filedialog.askdirectory(
        initialdir=initial_dir,
        title="Select dataset folder",
    )
    root.destroy()
    return folder or None


@router.post("/pick-folder", response_model=PickResponse)
def pick_folder(initial_path: str = Query(default="~")):
    """
    Open a native OS folder-picker dialog and return the selected path.
    Returns {path: str, available: true} on success.
    Returns {path: null, available: true} if user cancelled.
    Returns {path: null, available: false} if native picker is unavailable
    (e.g. macOS non-main-thread, headless server) — UI should show browser fallback.
    """
    import sys

    initial_dir = str(Path(initial_path).expanduser().resolve())
    if not Path(initial_dir).exists():
        initial_dir = str(Path.home())

    # On macOS, tkinter dialogs require the main thread / NSApplication; uvicorn
    # workers run off the main thread so the dialog silently returns empty string.
    # Skip native picker and signal the browser fallback to open instead.
    if sys.platform == "darwin":
        return PickResponse(path=None, available=False)

    result: list[str | None] = [None]
    exc: list[Exception | None] = [None]

    def run():
        try:
            result[0] = _open_native_picker(initial_dir)
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(timeout=120)

    if exc[0] is not None:
        logger.warning("Native picker failed: %s", exc[0])
        return PickResponse(path=None, available=False)

    return PickResponse(path=result[0], available=True)


# ------------------------------------------------------------------
# Image file server
# ------------------------------------------------------------------

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}

@router.get("/image")
def serve_image(path: str = Query(...)):
    """Serve an image file from an absolute path on disk."""
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    if resolved.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not an image file")
    media_type = mimetypes.guess_type(str(resolved))[0] or "image/jpeg"
    return FileResponse(str(resolved), media_type=media_type)


# ------------------------------------------------------------------
# In-browser directory browser (fallback / supplement)
# ------------------------------------------------------------------

@router.get("/browse", response_model=BrowseResponse)
def browse_directory(path: str = Query(default="~")):
    """
    List the contents of a directory for in-browser folder navigation.
    Returns folders first, then files, with dataset detection.
    """
    resolved = Path(path).expanduser().resolve()
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    parent = str(resolved.parent) if resolved != resolved.parent else None

    entries: list[DirEntry] = []
    try:
        for child in sorted(resolved.iterdir()):
            # Skip hidden files/dirs
            if child.name.startswith("."):
                continue
            try:
                is_dir = child.is_dir()
                is_dataset = is_dir and _looks_like_dataset(child)
                entries.append(
                    DirEntry(
                        name=child.name,
                        path=str(child),
                        is_dir=is_dir,
                        is_dataset=is_dataset,
                    )
                )
            except PermissionError:
                continue
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # Dirs first, then files
    entries.sort(key=lambda e: (not e.is_dir, e.name.lower()))

    return BrowseResponse(path=str(resolved), parent=parent, entries=entries)


def _looks_like_dataset(folder: Path) -> bool:
    yaml_names = {"data.yaml", "dataset.yaml", "data.yml", "dataset.yml"}
    for name in yaml_names:
        if (folder / name).exists():
            return True
    # Also check one level deeper
    try:
        for child in folder.iterdir():
            if child.is_dir():
                for name in yaml_names:
                    if (child / name).exists():
                        return True
    except PermissionError:
        pass
    return False
