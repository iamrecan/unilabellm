"""
CLIP-based confidence scorer for dataset validation.

For each image+label pair, computes cosine similarity between the image
embedding and the class name text embedding. Low-scoring pairs are flagged
as suspicious — likely mislabeled or wrong harmonization mapping.

Model: openai/clip-vit-base-patch32 (~151M params, CPU-friendly)
Speed: ~30-80ms per image on CPU
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

logger = logging.getLogger(__name__)

_MODEL_ID = "openai/clip-vit-base-patch32"

# Module-level cache so we don't reload on every request
_model: CLIPModel | None = None
_processor: CLIPProcessor | None = None


def _load_model() -> tuple[CLIPModel, CLIPProcessor]:
    global _model, _processor
    if _model is None:
        logger.info("Loading CLIP model %s …", _MODEL_ID)
        _model = CLIPModel.from_pretrained(_MODEL_ID)
        _processor = CLIPProcessor.from_pretrained(_MODEL_ID)
        _model.eval()
        logger.info("CLIP model loaded.")
    return _model, _processor  # type: ignore[return-value]


# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class LabelScore:
    """CLIP confidence for a single label on a single image."""
    class_name: str
    confidence: float          # 0.0 – 1.0 (softmax probability)
    raw_similarity: float      # raw cosine similarity before softmax


@dataclass
class ImageValidationResult:
    """Full validation result for one image."""
    image_path: str
    source_name: str
    scores: list[LabelScore]   # one per canonical class
    assigned_labels: list[str] # what YOLO says is in the image
    top_class: str             # CLIP's best guess among canonical classes
    top_confidence: float
    is_suspicious: bool        # True when assigned label confidence < threshold
    suspicion_reason: str = ""


@dataclass
class ValidationRun:
    """Aggregated result for a full session validation pass."""
    session_id: str
    total_images: int
    suspicious_count: int
    threshold: float
    results: list[ImageValidationResult] = field(default_factory=list)

    @property
    def suspicious_ratio(self) -> float:
        return self.suspicious_count / max(self.total_images, 1)


# ── Core scorer ──────────────────────────────────────────────────────────────

class CLIPScorer:
    """
    Scores image-label pairs using CLIP embeddings.

    Usage:
        scorer = CLIPScorer()
        run = scorer.score_session(session, on_progress=lambda p: print(p))
    """

    def __init__(self, threshold: float = 0.25, device: str | None = None) -> None:
        """
        threshold: images where the assigned label's confidence < threshold
                   are marked suspicious. 0.25 works well for CLIP-ViT-B/32.
        """
        self.threshold = threshold
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    def score_session(
        self,
        sources: list,          # list[DatasetSource]
        canonical_classes: list,  # list[CanonicalClass]
        on_progress: "Callable[[dict], None] | None" = None,
        max_images_per_source: int = 200,
    ) -> ValidationRun:
        from core.models import DatasetSource, CanonicalClass  # avoid circular

        model, processor = _load_model()
        model = model.to(self.device)

        class_names = [cc.name for cc in canonical_classes]
        if not class_names:
            raise ValueError("No canonical classes — run LLM analysis first.")

        # Pre-compute text embeddings for all class names (cheap, do once)
        text_embeddings = self._encode_texts(model, processor, class_names)

        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
        results: list[ImageValidationResult] = []
        total_processed = 0

        for source in sources:
            root = Path(source.path)
            images = [p for p in root.rglob("*") if p.suffix.lower() in image_extensions]
            images = sorted(images)[:max_images_per_source]

            # Build alias→canonical map for this source
            alias_to_canonical: dict[str, str] = {}
            for cc in canonical_classes:
                for alias in cc.aliases:
                    alias_to_canonical[alias] = cc.name

            for img_path in images:
                try:
                    assigned = self._get_assigned_labels(img_path, root, source, alias_to_canonical)
                    result = self._score_image(
                        model, processor, img_path, source.name,
                        class_names, text_embeddings, assigned,
                    )
                    results.append(result)
                    total_processed += 1

                    if on_progress:
                        on_progress({
                            "done": total_processed,
                            "total": sum(
                                min(len([p for p in Path(s.path).rglob("*")
                                         if p.suffix.lower() in image_extensions]),
                                    max_images_per_source)
                                for s in sources
                            ),
                            "phase": f"Scoring {source.name}",
                        })
                except Exception as e:
                    logger.warning("Skipping %s: %s", img_path, e)

        suspicious = [r for r in results if r.is_suspicious]
        return ValidationRun(
            session_id="",
            total_images=len(results),
            suspicious_count=len(suspicious),
            threshold=self.threshold,
            results=results,
        )

    # ── Private helpers ───────────────────────────────────────────────────────

    def _encode_texts(
        self,
        model: CLIPModel,
        processor: CLIPProcessor,
        texts: list[str],
    ) -> torch.Tensor:
        """Return L2-normalised text embeddings, shape (N, D)."""
        # Prepend "a photo of a" — CLIP prompt engineering 101
        prompted = [f"a photo of a {t}" for t in texts]
        inputs = processor(text=prompted, return_tensors="pt", padding=True, truncation=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            emb = model.get_text_features(**inputs)
        return emb / emb.norm(dim=-1, keepdim=True)

    def _encode_image(
        self,
        model: CLIPModel,
        processor: CLIPProcessor,
        img_path: Path,
    ) -> torch.Tensor:
        """Return L2-normalised image embedding, shape (1, D)."""
        image = Image.open(img_path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            emb = model.get_image_features(**inputs)
        return emb / emb.norm(dim=-1, keepdim=True)

    def _score_image(
        self,
        model: CLIPModel,
        processor: CLIPProcessor,
        img_path: Path,
        source_name: str,
        class_names: list[str],
        text_embeddings: torch.Tensor,
        assigned_labels: list[str],
    ) -> ImageValidationResult:
        img_emb = self._encode_image(model, processor, img_path)

        # Cosine similarities (already L2-normalised)
        sims = (img_emb @ text_embeddings.T).squeeze(0)  # (N,)
        probs = torch.softmax(sims * 100, dim=0)         # temperature scaling

        scores = [
            LabelScore(
                class_name=class_names[i],
                confidence=float(probs[i]),
                raw_similarity=float(sims[i]),
            )
            for i in range(len(class_names))
        ]

        top_idx = int(probs.argmax())
        top_class = class_names[top_idx]
        top_conf = float(probs[top_idx])

        # Suspicion: any assigned label with confidence < threshold
        is_suspicious = False
        suspicion_reason = ""
        if assigned_labels:
            assigned_scores = {s.class_name: s.confidence for s in scores}
            for label in assigned_labels:
                conf = assigned_scores.get(label, 0.0)
                if conf < self.threshold:
                    is_suspicious = True
                    suspicion_reason = (
                        f"Label '{label}' has low CLIP confidence ({conf:.2f}). "
                        f"CLIP's top guess: '{top_class}' ({top_conf:.2f})."
                    )
                    break
        else:
            # No label — check if CLIP sees anything with high confidence
            if top_conf > 0.5:
                is_suspicious = True
                suspicion_reason = (
                    f"Image has no labels but CLIP sees '{top_class}' "
                    f"with high confidence ({top_conf:.2f})."
                )

        return ImageValidationResult(
            image_path=str(img_path),
            source_name=source_name,
            scores=scores,
            assigned_labels=assigned_labels,
            top_class=top_class,
            top_confidence=top_conf,
            is_suspicious=is_suspicious,
            suspicion_reason=suspicion_reason,
        )

    def _get_assigned_labels(
        self,
        img_path: Path,
        root: Path,
        source,
        alias_to_canonical: dict[str, str],
    ) -> list[str]:
        """Read the YOLO label file and return canonical class names for this image."""
        rel = img_path.relative_to(root)
        parts = list(rel.parts)
        if "images" in parts:
            parts[parts.index("images")] = "labels"
        label_path = root / Path(*parts).with_suffix(".txt")
        if not label_path.exists():
            label_path = img_path.with_suffix(".txt")
        if not label_path.exists():
            return []

        labels: list[str] = []
        try:
            for line in label_path.read_text().strip().splitlines():
                p = line.split()
                if not p:
                    continue
                class_id = int(p[0])
                if class_id < len(source.classes):
                    raw_name = source.classes[class_id]
                    canonical = alias_to_canonical.get(raw_name, raw_name)
                    if canonical not in labels:
                        labels.append(canonical)
        except Exception:
            pass
        return labels
