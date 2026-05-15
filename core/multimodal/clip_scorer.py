"""
CLIP validation backend — image-level + crop-mode scoring.

Kept as a legacy/alternative option. OWL-ViT is the recommended default
for most datasets; CLIP remains useful for quick checks or when OWL-ViT
is not available.

Model: openai/clip-vit-base-patch32 (~151M params)
Speed: ~50-80ms per crop on CPU
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

from .base import (
    BoxValidation, ImageValidationResult, LabelScore, ValidationRun,
)

logger = logging.getLogger(__name__)

_MODEL_ID = "openai/clip-vit-base-patch32"
_MIN_CROP_PX = 10

_model: CLIPModel | None = None
_processor: CLIPProcessor | None = None


def _load():
    global _model, _processor
    if _model is None:
        logger.info("Loading CLIP model %s …", _MODEL_ID)
        _model = CLIPModel.from_pretrained(_MODEL_ID)
        _processor = CLIPProcessor.from_pretrained(_MODEL_ID)
        _model.eval()
    return _model, _processor  # type: ignore[return-value]


class CLIPScorer:
    """CLIP-based crop scorer (legacy / optional backend)."""

    BACKEND_NAME = "clip"

    def __init__(self, threshold: float = 0.25, device: str | None = None) -> None:
        self.threshold = threshold
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    # ── Public API ────────────────────────────────────────────────────────────

    def score_session(
        self,
        sources: list,
        canonical_classes: list,
        on_progress: Callable[[dict], None] | None = None,
        max_images_per_source: int = 200,
    ) -> ValidationRun:
        model, processor = _load()
        model = model.to(self.device)

        class_names = [cc.name for cc in canonical_classes]
        if not class_names:
            raise ValueError("No canonical classes — run LLM analysis first.")

        text_embeddings = self._encode_texts(model, processor, class_names)

        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
        results: list[ImageValidationResult] = []
        total_processed = 0

        total_count = sum(
            min(len([p for p in Path(s.path).rglob("*") if p.suffix.lower() in image_extensions]),
                max_images_per_source)
            for s in sources
        )

        for source in sources:
            root = Path(source.path)
            images = sorted(
                p for p in root.rglob("*") if p.suffix.lower() in image_extensions
            )[:max_images_per_source]

            alias_to_canonical: dict[str, str] = {}
            for cc in canonical_classes:
                for alias in cc.aliases:
                    alias_to_canonical[alias] = cc.name

            for img_path in images:
                try:
                    annotations = _get_annotations(img_path, root, source, alias_to_canonical)
                    result = self._score_image(
                        model, processor, img_path, source.name,
                        class_names, text_embeddings, annotations,
                    )
                    results.append(result)
                except Exception as e:
                    logger.warning("Skipping %s: %s", img_path, e)
                finally:
                    total_processed += 1
                    if on_progress:
                        on_progress({"done": total_processed, "total": total_count,
                                     "phase": f"CLIP · {source.name}"})

        suspicious = [r for r in results if r.is_suspicious]
        return ValidationRun(
            session_id="", total_images=len(results),
            suspicious_count=len(suspicious), threshold=self.threshold,
            backend=self.BACKEND_NAME, results=results,
        )

    # ── Private helpers ───────────────────────────────────────────────────────

    def _encode_texts(self, model, processor, texts: list[str]) -> torch.Tensor:
        prompted = [f"a photo of a {t}" for t in texts]
        inputs = processor(text=prompted, return_tensors="pt", padding=True, truncation=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            emb = model.get_text_features(**inputs)
        return emb / emb.norm(dim=-1, keepdim=True)

    def _encode_pil(self, model, processor, image: Image.Image) -> torch.Tensor:
        inputs = processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            emb = model.get_image_features(**inputs)
        return emb / emb.norm(dim=-1, keepdim=True)

    def _score_crop(self, model, processor, crop: Image.Image,
                    class_names: list[str], text_emb: torch.Tensor):
        img_emb = self._encode_pil(model, processor, crop)
        sims = (img_emb @ text_emb.T).squeeze(0)
        probs = torch.softmax(sims * 100, dim=0)
        scores = [LabelScore(class_names[i], float(probs[i]), float(sims[i]))
                  for i in range(len(class_names))]
        top_idx = int(probs.argmax())
        return scores, class_names[top_idx], float(probs[top_idx])

    def _score_image(self, model, processor, img_path: Path, source_name: str,
                     class_names: list[str], text_emb: torch.Tensor,
                     annotations: list) -> ImageValidationResult:
        img = Image.open(img_path).convert("RGB")
        W, H = img.size

        box_validations: list[BoxValidation] = []
        score_acc: dict[str, list[float]] = {cn: [] for cn in class_names}

        target_annotations = annotations or [(-1, "", 0.5, 0.5, 1.0, 1.0)]  # full image fallback
        for box_index, class_name, cx, cy, bw, bh in target_annotations:
            crop = _crop_box(img, W, H, cx, cy, bw, bh) or img
            scores, top_class, top_conf = self._score_crop(model, processor, crop, class_names, text_emb)
            conf_map = {s.class_name: s.confidence for s in scores}
            assigned_conf = conf_map.get(class_name, 0.0) if class_name else 0.0
            for s in scores:
                score_acc[s.class_name].append(s.confidence)
            if box_index >= 0:
                box_validations.append(BoxValidation(
                    box_index=box_index, class_name=class_name,
                    cx=cx, cy=cy, w=bw, h=bh,
                    assigned_confidence=assigned_conf,
                    top_class=top_class, top_confidence=top_conf,
                    scores=scores, is_suspicious=assigned_conf < self.threshold,
                ))

        return _build_result(img_path, source_name, box_validations, score_acc,
                             class_names, self.threshold, self.BACKEND_NAME)


# ── Shared helpers (used by multiple scorers) ─────────────────────────────────

def _crop_box(img: Image.Image, W: int, H: int,
              cx: float, cy: float, bw: float, bh: float,
              pad: int = 6) -> Image.Image | None:
    x1 = max(0, int((cx - bw / 2) * W) - pad)
    y1 = max(0, int((cy - bh / 2) * H) - pad)
    x2 = min(W, int((cx + bw / 2) * W) + pad)
    y2 = min(H, int((cy + bh / 2) * H) + pad)
    if x2 - x1 < _MIN_CROP_PX or y2 - y1 < _MIN_CROP_PX:
        return None
    return img.crop((x1, y1, x2, y2))


def _build_result(
    img_path: Path,
    source_name: str,
    box_validations: list[BoxValidation],
    score_acc: dict[str, list[float]],
    class_names: list[str],
    threshold: float,
    backend: str,
) -> ImageValidationResult:
    agg_scores = sorted(
        [LabelScore(cn, sum(v) / len(v) if v else 0.0, 0.0) for cn, v in score_acc.items()],
        key=lambda s: -s.confidence,
    )
    is_suspicious = any(bv.is_suspicious for bv in box_validations)
    suspicion_reason = ""
    if is_suspicious:
        worst = min((bv for bv in box_validations if bv.is_suspicious),
                    key=lambda bv: bv.assigned_confidence)
        suspicion_reason = (
            f"Box #{worst.box_index} ({worst.class_name!r}) scored "
            f"{worst.assigned_confidence:.0%} — "
            f"model suggests '{worst.top_class}' ({worst.top_confidence:.0%})."
        )
    assigned_labels = list(dict.fromkeys(bv.class_name for bv in box_validations))
    best = max(box_validations, key=lambda bv: bv.top_confidence) if box_validations else None
    return ImageValidationResult(
        image_path=str(img_path),
        source_name=source_name,
        box_validations=box_validations,
        scores=agg_scores,
        assigned_labels=assigned_labels,
        top_class=best.top_class if best else (agg_scores[0].class_name if agg_scores else ""),
        top_confidence=best.top_confidence if best else (agg_scores[0].confidence if agg_scores else 0.0),
        is_suspicious=is_suspicious,
        suspicion_reason=suspicion_reason,
        backend=backend,
    )


def _get_annotations(img_path: Path, root: Path, source, alias_to_canonical: dict) -> list:
    rel = img_path.relative_to(root)
    parts = list(rel.parts)
    if "images" in parts:
        parts[parts.index("images")] = "labels"
    label_path = root / Path(*parts).with_suffix(".txt")
    if not label_path.exists():
        label_path = img_path.with_suffix(".txt")
    if not label_path.exists():
        return []
    annotations = []
    try:
        for i, line in enumerate(label_path.read_text().strip().splitlines()):
            p = line.split()
            if len(p) < 5:
                continue
            class_id = int(p[0])
            cx, cy, bw, bh = float(p[1]), float(p[2]), float(p[3]), float(p[4])
            if class_id < len(source.classes):
                raw = source.classes[class_id]
                canonical = alias_to_canonical.get(raw, raw)
                annotations.append((i, canonical, cx, cy, bw, bh))
    except Exception:
        pass
    return annotations
