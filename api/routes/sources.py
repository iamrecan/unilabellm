from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.models import DatasetSource
from core.parser.yolo import parse_dataset
from core.sources.manager import SourceManager

router = APIRouter(prefix="/sources", tags=["sources"])


# ------------------------------------------------------------------
# Request / Response schemas
# ------------------------------------------------------------------

class ScanSourceRequest(BaseModel):
    path: str
    name: str | None = None


class KaggleAddRequest(BaseModel):
    identifier: str          # "owner/dataset-slug" or "owner/slug/subpath"
    name: str | None = None


class RoboflowAddRequest(BaseModel):
    identifier: str          # "workspace/project" or "workspace/project/version"
    name: str | None = None
    format: str = "yolov8"


class URLAddRequest(BaseModel):
    url: str
    name: str | None = None


class ProviderStatus(BaseModel):
    provider: str
    available: bool
    reason: str


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.post("/scan", response_model=DatasetSource)
def scan_source(body: ScanSourceRequest):
    """Scan a local directory and return a DatasetSource."""
    try:
        return parse_dataset(body.path, name=body.name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NotADirectoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/providers", response_model=list[ProviderStatus])
def list_providers():
    """Check which external source providers are available."""
    manager = SourceManager()
    result = []
    labels = {"kaggle": "Kaggle", "roboflow": "Roboflow", "url": "URL"}
    for key, (ok, reason) in manager.check_availability().items():
        result.append(ProviderStatus(provider=labels[key], available=ok, reason=reason))
    return result


@router.post("/kaggle", response_model=DatasetSource, status_code=201)
def add_from_kaggle(body: KaggleAddRequest):
    """
    Download a dataset from Kaggle and add it to the workspace.

    Requires `kaggle` package and credentials (KAGGLE_USERNAME + KAGGLE_KEY).
    """
    manager = SourceManager()
    ok, reason = manager._providers["kaggle"].is_available()
    if not ok:
        raise HTTPException(
            status_code=503,
            detail=f"Kaggle not available: {reason}. "
                   "Install `kaggle` and set KAGGLE_USERNAME + KAGGLE_KEY.",
        )
    try:
        return manager.add_from_kaggle(body.identifier, name=body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/roboflow", response_model=DatasetSource, status_code=201)
def add_from_roboflow(body: RoboflowAddRequest):
    """
    Download a dataset from Roboflow Universe and add it to the workspace.

    Requires `roboflow` package and ROBOFLOW_API_KEY env var.
    """
    manager = SourceManager()
    ok, reason = manager._providers["roboflow"].is_available()
    if not ok:
        raise HTTPException(
            status_code=503,
            detail=f"Roboflow not available: {reason}. "
                   "Install `roboflow` and set ROBOFLOW_API_KEY.",
        )
    try:
        return manager.add_from_roboflow(body.identifier, name=body.name, format=body.format)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/url", response_model=DatasetSource, status_code=201)
def add_from_url(body: URLAddRequest):
    """
    Download a dataset from a direct URL (zip/tar archive) and add it to the workspace.
    """
    manager = SourceManager()
    try:
        return manager.add_from_url(body.url, name=body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
