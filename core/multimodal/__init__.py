"""
Validation backend factory.

Usage:
    from core.multimodal import get_scorer
    scorer = get_scorer("owl-vit", threshold=0.10)
    run = scorer.score_session(sources, canonical_classes, on_progress=cb)
"""
from __future__ import annotations

from .base import BoxValidation, ImageValidationResult, LabelScore, ValidationRun

AVAILABLE_BACKENDS = ["owl-vit", "siglip", "clip"]
DEFAULT_BACKEND = "owl-vit"

DEFAULT_THRESHOLDS: dict[str, float] = {
    "owl-vit": 0.10,
    "siglip":  0.15,
    "clip":    0.25,   # legacy
}


def get_scorer(backend: str = DEFAULT_BACKEND, threshold: float | None = None, device: str | None = None):
    """Return a scorer instance for the given backend."""
    t = threshold if threshold is not None else DEFAULT_THRESHOLDS.get(backend, 0.10)

    if backend == "owl-vit":
        from .owl_scorer import OWLScorer
        return OWLScorer(threshold=t, device=device)

    if backend == "siglip":
        from .siglip_scorer import SigLIPScorer
        return SigLIPScorer(threshold=t, device=device)

    if backend == "clip":
        from .clip_scorer import CLIPScorer
        return CLIPScorer(threshold=t, device=device)

    raise ValueError(f"Unknown backend: {backend!r}. Choose from: {AVAILABLE_BACKENDS}")


__all__ = [
    "get_scorer", "AVAILABLE_BACKENDS", "DEFAULT_BACKEND", "DEFAULT_THRESHOLDS",
    "BoxValidation", "ImageValidationResult", "LabelScore", "ValidationRun",
]
