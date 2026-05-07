from __future__ import annotations

import threading
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.schemas import ExportRequest
from core.exporter.yolo import export_dataset
from core.harmonizer import session as session_mgr
from core.models import ExportConfig

router = APIRouter(prefix="/sessions", tags=["export"])


class ZipRequest(BaseModel):
    output_path: str  # directory to zip


class ZipResponse(BaseModel):
    zip_path: str
    size_mb: float

# In-memory export status store (for demo; production would use a DB)
_export_status: dict[str, dict] = {}


@router.post("/{session_id}/export")
def start_export(session_id: str, body: ExportRequest):
    """Start an async export of a confirmed session. Poll /export/status for progress."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    if session.status not in ("confirmed", "exported"):
        raise HTTPException(
            status_code=409,
            detail=f"Session must be 'confirmed' before export (current: {session.status})",
        )

    config = ExportConfig(
        output_path=body.output_path,
        split_ratio=body.split_ratio,
        seed=body.seed,
    )

    _export_status[session_id] = {"status": "running", "phase": "starting", "done": 0, "total": 0}

    def _run() -> None:
        try:
            def on_progress(p: dict) -> None:
                _export_status[session_id].update(p)

            summary = export_dataset(
                session, config,
                annotation_overrides=session.annotation_overrides or {},
                on_progress=on_progress,
            )
            session.transition("exported")
            session_mgr.save_session(session)
            _export_status[session_id] = {"status": "done", "summary": summary.model_dump()}
        except Exception as exc:
            _export_status[session_id] = {"status": "failed", "error": str(exc)}

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "running", "session_id": session_id}


@router.get("/{session_id}/export/status")
def export_status(session_id: str):
    """Check the export status for a session."""
    status = _export_status.get(session_id)
    if status is None:
        raise HTTPException(status_code=404, detail="No export found for this session")
    return status


@router.post("/{session_id}/package-zip", response_model=ZipResponse)
def package_zip(session_id: str, body: ZipRequest):
    """Zip an exported dataset directory for Kaggle upload."""
    src_dir = Path(body.output_path).expanduser().resolve()
    if not src_dir.exists() or not src_dir.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory not found: {body.output_path}")

    zip_path = src_dir.parent / f"{src_dir.name}_kaggle.zip"

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
            for file in src_dir.rglob("*"):
                if file.is_file():
                    zf.write(file, file.relative_to(src_dir))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create zip: {e}")

    size_mb = round(zip_path.stat().st_size / 1_048_576, 1)
    return ZipResponse(zip_path=str(zip_path), size_mb=size_mb)
