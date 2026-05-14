"""
CLIP-based dataset validation routes.

POST /sessions/{session_id}/validate        — start async validation run
GET  /sessions/{session_id}/validate/status — poll progress / results
"""
from __future__ import annotations

import threading
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from core.harmonizer import session as session_mgr

router = APIRouter(prefix="/sessions", tags=["validation"])

# In-memory store: session_id → status dict
_validation_status: dict[str, dict[str, Any]] = {}


# ── Request / Response schemas ────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    threshold: float = 0.25          # confidence below this = suspicious
    max_images_per_source: int = 100 # cap per source to keep it fast


class LabelScoreOut(BaseModel):
    class_name: str
    confidence: float
    raw_similarity: float


class ImageResultOut(BaseModel):
    image_path: str
    source_name: str
    assigned_labels: list[str]
    top_class: str
    top_confidence: float
    is_suspicious: bool
    suspicion_reason: str
    scores: list[LabelScoreOut]


class ValidationStatusOut(BaseModel):
    status: str                          # "running" | "done" | "failed"
    phase: str = ""
    done: int = 0
    total: int = 0
    # Only present when status == "done"
    total_images: int = 0
    suspicious_count: int = 0
    suspicious_ratio: float = 0.0
    threshold: float = 0.25
    results: list[ImageResultOut] = []
    error: str = ""


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{session_id}/validate", response_model=ValidationStatusOut)
def start_validation(session_id: str, body: ValidateRequest):
    """Start a CLIP-based confidence scoring run for a session (async)."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    if not session.canonical_classes:
        raise HTTPException(
            status_code=409,
            detail="Session has no canonical classes yet. Run LLM analysis first.",
        )

    if not session.sources:
        raise HTTPException(status_code=409, detail="Session has no dataset sources.")

    _validation_status[session_id] = {
        "status": "running",
        "phase": "Loading CLIP model…",
        "done": 0,
        "total": 0,
    }

    def _run() -> None:
        try:
            from core.multimodal.clip_scorer import CLIPScorer

            scorer = CLIPScorer(threshold=body.threshold)
            run = scorer.score_session(
                sources=session.sources,
                canonical_classes=session.canonical_classes,
                on_progress=lambda p: _validation_status[session_id].update(p),
                max_images_per_source=body.max_images_per_source,
            )
            run.session_id = session_id

            _validation_status[session_id] = {
                "status": "done",
                "phase": "complete",
                "done": run.total_images,
                "total": run.total_images,
                "total_images": run.total_images,
                "suspicious_count": run.suspicious_count,
                "suspicious_ratio": round(run.suspicious_ratio, 3),
                "threshold": run.threshold,
                "results": [
                    {
                        "image_path": r.image_path,
                        "source_name": r.source_name,
                        "assigned_labels": r.assigned_labels,
                        "top_class": r.top_class,
                        "top_confidence": round(r.top_confidence, 4),
                        "is_suspicious": r.is_suspicious,
                        "suspicion_reason": r.suspicion_reason,
                        "scores": [
                            {
                                "class_name": s.class_name,
                                "confidence": round(s.confidence, 4),
                                "raw_similarity": round(s.raw_similarity, 4),
                            }
                            for s in r.scores
                        ],
                    }
                    for r in run.results
                ],
            }
        except Exception as exc:
            _validation_status[session_id] = {
                "status": "failed",
                "error": str(exc),
                "phase": "",
                "done": 0,
                "total": 0,
            }

    threading.Thread(target=_run, daemon=True).start()
    return ValidationStatusOut(**_validation_status[session_id])


@router.get("/{session_id}/validate/status", response_model=ValidationStatusOut)
def validation_status(session_id: str):
    """Poll the validation status and results for a session."""
    status = _validation_status.get(session_id)
    if status is None:
        raise HTTPException(
            status_code=404,
            detail="No validation run found for this session. POST /validate first.",
        )
    return ValidationStatusOut(**status)


@router.get("/{session_id}/validate/suspicious", response_model=list[ImageResultOut])
def get_suspicious(
    session_id: str,
    limit: int = Query(default=50, le=500),
):
    """Return only the suspicious images from the last validation run."""
    status = _validation_status.get(session_id)
    if not status or status.get("status") != "done":
        raise HTTPException(
            status_code=404,
            detail="No completed validation run found. POST /validate and wait.",
        )
    suspicious = [r for r in status.get("results", []) if r["is_suspicious"]]
    return suspicious[:limit]
