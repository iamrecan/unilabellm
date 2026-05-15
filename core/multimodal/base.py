"""
Shared data classes and protocol for all validation backends.

Any scorer (CLIP, OWL-ViT, Florence-2, …) must implement the
`ValidationBackend` protocol and return these types.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Callable


# ── Shared data classes ───────────────────────────────────────────────────────

@dataclass
class LabelScore:
    """Confidence for one class label on one crop/image."""
    class_name: str
    confidence: float       # 0–1, normalised
    raw_similarity: float   # backend-specific raw score


@dataclass
class BoxValidation:
    """Validation result for a single YOLO annotation box."""
    box_index: int
    class_name: str         # assigned canonical class
    cx: float               # YOLO normalised coords
    cy: float
    w: float
    h: float
    assigned_confidence: float  # score for the assigned class on this crop
    top_class: str              # backend's best guess
    top_confidence: float
    scores: list[LabelScore]    # all classes scored
    is_suspicious: bool
    description: str = ""       # optional free-text (used by Florence-2)


@dataclass
class ImageValidationResult:
    """Full validation result for one image."""
    image_path: str
    source_name: str
    box_validations: list[BoxValidation]
    scores: list[LabelScore]    # aggregate across boxes (for "CLIP also sees")
    assigned_labels: list[str]
    top_class: str
    top_confidence: float
    is_suspicious: bool
    suspicion_reason: str = ""
    backend: str = ""           # which model produced this


@dataclass
class ValidationRun:
    """Aggregated result for a full session validation pass."""
    session_id: str
    total_images: int
    suspicious_count: int
    threshold: float
    backend: str
    results: list[ImageValidationResult] = field(default_factory=list)

    @property
    def suspicious_ratio(self) -> float:
        return self.suspicious_count / max(self.total_images, 1)


# ── Protocol ─────────────────────────────────────────────────────────────────

class ValidationBackend(Protocol):
    """Any validation scorer must implement this interface."""

    def score_session(
        self,
        sources: list,
        canonical_classes: list,
        on_progress: Callable[[dict], None] | None,
        max_images_per_source: int,
    ) -> ValidationRun: ...
