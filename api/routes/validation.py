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
    backend: str = "owl-vit"         # "owl-vit" | "clip"
    threshold: float | None = None   # None → backend default
    max_images_per_source: int = 100


class LabelScoreOut(BaseModel):
    class_name: str
    confidence: float
    raw_similarity: float


class BoxValidationOut(BaseModel):
    box_index: int
    class_name: str
    cx: float
    cy: float
    w: float
    h: float
    assigned_confidence: float
    top_class: str
    top_confidence: float
    scores: list[LabelScoreOut]
    is_suspicious: bool


class ImageResultOut(BaseModel):
    image_path: str
    source_name: str
    box_validations: list[BoxValidationOut] = []
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
        "phase": f"Loading {body.backend} model…",
        "done": 0,
        "total": 0,
    }

    def _run() -> None:
        try:
            from core.multimodal import get_scorer, DEFAULT_THRESHOLDS

            threshold = body.threshold if body.threshold is not None \
                        else DEFAULT_THRESHOLDS.get(body.backend, 0.10)
            scorer = get_scorer(backend=body.backend, threshold=threshold)
            run = scorer.score_session(
                sources=session.sources,
                canonical_classes=session.canonical_classes,
                on_progress=lambda p: _validation_status[session_id].update(p),
                max_images_per_source=body.max_images_per_source,
            )
            _validation_status[session_id]["phase"] = f"Scored with {body.backend}"
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
                        "box_validations": [
                            {
                                "box_index": bv.box_index,
                                "class_name": bv.class_name,
                                "cx": bv.cx, "cy": bv.cy,
                                "w": bv.w, "h": bv.h,
                                "assigned_confidence": round(bv.assigned_confidence, 4),
                                "top_class": bv.top_class,
                                "top_confidence": round(bv.top_confidence, 4),
                                "is_suspicious": bv.is_suspicious,
                                "scores": [
                                    {
                                        "class_name": s.class_name,
                                        "confidence": round(s.confidence, 4),
                                        "raw_similarity": round(s.raw_similarity, 4),
                                    }
                                    for s in bv.scores
                                ],
                            }
                            for bv in r.box_validations
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


# ── Per-image endpoints (synchronous, for lightbox use) ───────────────────────

class SingleImageRequest(BaseModel):
    image_path: str
    backend: str = "owl-vit"
    threshold: float | None = None


class DetectBoxesRequest(BaseModel):
    image_path: str
    backend: str = "owl-vit"
    threshold: float = 0.05


class DetectedBox(BaseModel):
    class_name: str
    class_id: int
    cx: float
    cy: float
    w: float
    h: float
    confidence: float


def _serialize_image_result(r) -> dict:
    """Convert an ImageValidationResult dataclass to the API dict format."""
    return {
        "image_path": r.image_path,
        "source_name": r.source_name,
        "assigned_labels": r.assigned_labels,
        "top_class": r.top_class,
        "top_confidence": round(r.top_confidence, 4),
        "is_suspicious": r.is_suspicious,
        "suspicion_reason": r.suspicion_reason,
        "backend": getattr(r, "backend", ""),
        "scores": [
            {"class_name": s.class_name, "confidence": round(s.confidence, 4),
             "raw_similarity": round(s.raw_similarity, 4)}
            for s in r.scores
        ],
        "box_validations": [
            {
                "box_index": bv.box_index, "class_name": bv.class_name,
                "cx": bv.cx, "cy": bv.cy, "w": bv.w, "h": bv.h,
                "assigned_confidence": round(bv.assigned_confidence, 4),
                "top_class": bv.top_class,
                "top_confidence": round(bv.top_confidence, 4),
                "is_suspicious": bv.is_suspicious,
                "scores": [
                    {"class_name": s.class_name, "confidence": round(s.confidence, 4),
                     "raw_similarity": round(s.raw_similarity, 4)}
                    for s in bv.scores
                ],
            }
            for bv in r.box_validations
        ],
    }


@router.post("/{session_id}/validate/image", response_model=ImageResultOut)
def validate_single_image(session_id: str, body: SingleImageRequest):
    """
    Validate a single image synchronously — for the lightbox 'Validate' button.
    Returns immediately (~200-500ms on CPU).
    """
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    from core.multimodal import get_scorer, DEFAULT_THRESHOLDS
    from core.multimodal.clip_scorer import _get_annotations
    from pathlib import Path

    class_names = [cc.name for cc in session.canonical_classes]
    if not class_names:
        raise HTTPException(status_code=409, detail="No canonical classes yet.")

    threshold = body.threshold if body.threshold is not None \
                else DEFAULT_THRESHOLDS.get(body.backend, 0.10)
    scorer = get_scorer(backend=body.backend, threshold=threshold)

    # Find which source this image belongs to, build alias map
    img_path = Path(body.image_path)
    matched_source = None
    alias_to_canonical: dict[str, str] = {}
    for cc in session.canonical_classes:
        for alias in cc.aliases:
            alias_to_canonical[alias] = cc.name

    for src in session.sources:
        try:
            img_path.relative_to(src.path)
            matched_source = src
            break
        except ValueError:
            continue

    if matched_source is None:
        # fallback: use first source's class list
        matched_source = session.sources[0] if session.sources else None

    annotations = []
    if matched_source:
        root = Path(matched_source.path)
        try:
            annotations = _get_annotations(img_path, root, matched_source, alias_to_canonical)
        except Exception:
            pass

    source_name = matched_source.name if matched_source else "unknown"

    try:
        result = scorer.score_single(
            image_path=body.image_path,
            source_name=source_name,
            annotations=annotations,
            class_names=class_names,
        )
    except AttributeError:
        # CLIP scorer doesn't have score_single — fall back via score_session
        raise HTTPException(status_code=400, detail=f"Backend '{body.backend}' does not support per-image validation yet.")

    return _serialize_image_result(result)


@router.post("/{session_id}/detect-boxes", response_model=list[DetectedBox])
def detect_boxes(session_id: str, body: DetectBoxesRequest):
    """
    Run open-vocabulary detection on a single image.
    Returns suggested bounding boxes (YOLO normalised) the user can accept/dismiss.
    """
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    class_names = [cc.name for cc in session.canonical_classes]
    if not class_names:
        raise HTTPException(status_code=409, detail="No canonical classes yet.")

    if body.backend != "owl-vit":
        raise HTTPException(status_code=400, detail="detect-boxes only supports owl-vit backend.")

    from core.multimodal.owl_scorer import OWLScorer
    scorer = OWLScorer()
    try:
        boxes = scorer.detect_boxes(
            image_path=body.image_path,
            class_names=class_names,
            threshold=body.threshold,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return boxes
