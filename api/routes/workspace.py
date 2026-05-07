from fastapi import APIRouter, HTTPException

from core.models import DatasetSource
from core.workspace.manager import WorkspaceManager

router = APIRouter(prefix="/workspace", tags=["workspace"])
manager = WorkspaceManager()


@router.get("/datasets", response_model=list[DatasetSource])
def list_datasets():
    return manager.list_datasets()


@router.post("/datasets", response_model=DatasetSource, status_code=201)
def add_dataset(body: dict):
    path = body.get("path")
    name = body.get("name")
    if not path:
        raise HTTPException(status_code=400, detail="'path' is required")
    try:
        return manager.add_dataset(path, name=name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/datasets/{dataset_name}", status_code=204)
def remove_dataset(dataset_name: str):
    manager.remove_dataset(dataset_name)


@router.post("/datasets/{dataset_name}/rescan", response_model=DatasetSource)
def rescan_dataset(dataset_name: str):
    try:
        return manager.rescan_dataset(dataset_name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_name}")
